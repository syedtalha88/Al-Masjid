// The worker's job runtime (01 §5.8, PHASE_04 T4.1): one BullMQ Worker per queue with its processor, every payload
// validated again before it runs (an invalid one fails at once, never retried), a deadline per run, the kill switch
// as a delay (the job waits, it is not lost or failed — T4.7), failures logged and reported on their last attempt,
// and the schedulers in Asia/Kolkata. Only the worker entrypoint (and tests) start it.
import type { DbHandle } from '@mc/db';
import { type Clock, systemClock } from '@mc/shared/clock';
import { DelayedError, type Job, type JobsOptions, UnrecoverableError, Worker } from 'bullmq';
import type { Redis } from 'ioredis';

import type { createLogger } from '../logger.ts';
import type { SendLedger } from '../push/ledger.ts';
import type { PushSender } from '../push/sender.ts';
import {
  InvalidJobPayloadError,
  JOB_NAMES,
  JOB_TIMEOUT_MS,
  type JobName,
  parseJobPayload,
  QUEUE_PREFIX,
} from '../queue/jobs.ts';
import { createJobQueues, type JobQueues } from '../queue/queues.ts';
import { processAlertSend } from './alerts/send.ts';
import { processFanout, PushPausedError } from './push/fanout.ts';
import { processSendBatch } from './push/send-batch.ts';
import { processOutboxSweep } from './push/sweeper.ts';

type Logger = ReturnType<typeof createLogger>;

/** How long a paused job waits before it looks at the kill switch again. */
export const PAUSE_RECHECK_MS = 60_000;
/** Jobs of one queue running at once in this process (send batches each keep 50 requests in flight). */
export const DEFAULT_CONCURRENCY: Readonly<Record<JobName, number>> = {
  'push-fanout': 2,
  'push-send-batch': 4,
  'alert-send': 2,
  'outbox-sweeper': 1,
};
/** Schedulers (01 §5.8), cron in India time. */
export const SCHEDULES: readonly { readonly job: JobName; readonly pattern: string }[] = [
  { job: 'outbox-sweeper', pattern: '* * * * *' },
];
export const SCHEDULE_TIME_ZONE = 'Asia/Kolkata';

export interface JobWorkerDeps {
  readonly db: DbHandle;
  /** BullMQ connection (`maxRetriesPerRequest: null`, no ioredis keyPrefix). */
  readonly connection: Redis;
  readonly ledger: SendLedger;
  readonly sender: PushSender;
  readonly logger: Logger;
  readonly clock?: Clock;
  /** BullMQ key prefix; tests pass their per-file prefix. */
  readonly prefix?: string;
  readonly concurrency?: Partial<Record<JobName, number>>;
  /** Install the schedulers (off in tests, which run the sweeper themselves). */
  readonly schedulers?: boolean;
  /** Reports a job's final failure (Sentry). */
  readonly report?: (error: unknown) => void;
  /** The kill-switch re-check delay (tests shorten it). */
  readonly pauseRecheckMs?: number;
  /** Per-job option overrides (tests shorten the backoff). */
  readonly jobOptions?: Partial<Record<JobName, JobsOptions>>;
}

export class JobTimeoutError extends Error {
  constructor(name: JobName, ms: number) {
    super(`${name} did not finish within ${String(ms)} ms`);
    this.name = 'JobTimeoutError';
  }
}

async function withTimeout<T>(name: JobName, run: Promise<T>): Promise<T> {
  const ms = JOB_TIMEOUT_MS[name];
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      run,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new JobTimeoutError(name, ms));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface RunningJobWorkers {
  readonly queues: JobQueues;
  /** Waits until every worker is connected. */
  ready(): Promise<void>;
  close(): Promise<void>;
}

/** Starts a worker for every queue. */
export async function startJobWorkers(deps: JobWorkerDeps): Promise<RunningJobWorkers> {
  const clock = deps.clock ?? systemClock;
  const prefix = deps.prefix ?? QUEUE_PREFIX;
  const queues = createJobQueues(deps.connection, prefix, deps.jobOptions);
  const pauseMs = deps.pauseRecheckMs ?? PAUSE_RECHECK_MS;
  const common = { db: deps.db, clock, logger: deps.logger };

  /** Validates `data` for `name` (invalid → InvalidJobPayloadError) and runs its processor. */
  const run = (name: JobName, data: unknown, final: boolean): Promise<unknown> => {
    switch (name) {
      case 'push-fanout':
        return processFanout({ ...common, queues }, parseJobPayload(name, data));
      case 'push-send-batch':
        return processSendBatch({ ...common, ledger: deps.ledger, sender: deps.sender }, parseJobPayload(name, data), {
          final,
        });
      case 'alert-send':
        return processAlertSend({ ...common, sender: deps.sender }, parseJobPayload(name, data), { final });
      case 'outbox-sweeper':
        parseJobPayload(name, data);
        return processOutboxSweep({ ...common, queues });
    }
  };

  const processor =
    (name: JobName) =>
    async (job: Job, token?: string): Promise<unknown> => {
      const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      try {
        return await withTimeout(name, run(name, job.data, final));
      } catch (error) {
        if (error instanceof InvalidJobPayloadError) throw new UnrecoverableError(error.message);
        if (error instanceof PushPausedError) {
          await job.moveToDelayed(Date.now() + pauseMs, token);
          throw new DelayedError();
        }
        throw error;
      }
    };

  const workers = JOB_NAMES.map((name) => {
    const worker = new Worker(name, processor(name), {
      connection: deps.connection,
      prefix,
      concurrency: deps.concurrency?.[name] ?? DEFAULT_CONCURRENCY[name],
    });
    worker.on('failed', (job, error) => {
      const attempts = job?.opts.attempts ?? 1;
      const last = (job?.attemptsMade ?? attempts) >= attempts || error instanceof UnrecoverableError;
      const entry = {
        job: name,
        id: job?.id,
        attempt: job?.attemptsMade,
        err: { name: error.name, message: error.message },
      };
      if (last) {
        deps.logger.error(entry, 'job failed (no attempts left)');
        deps.report?.(error);
      } else deps.logger.warn(entry, 'job failed; will retry');
    });
    worker.on('error', (error) => {
      deps.logger.error({ job: name, err: { name: error.name, message: error.message } }, 'job worker error');
    });
    return worker;
  });

  if (deps.schedulers ?? true) {
    for (const schedule of SCHEDULES) {
      await queues
        .queue(schedule.job)
        .upsertJobScheduler(
          schedule.job,
          { pattern: schedule.pattern, tz: SCHEDULE_TIME_ZONE },
          { name: schedule.job, data: {} },
        );
    }
  }

  return {
    queues,
    async ready() {
      await Promise.all(workers.map((worker) => worker.waitUntilReady()));
    },
    async close() {
      await Promise.all(workers.map((worker) => worker.close()));
      await queues.close();
    },
  };
}
