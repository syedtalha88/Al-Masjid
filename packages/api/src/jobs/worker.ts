// The worker's job runtime (01 §5.8, PHASE_04 T4.1): one BullMQ Worker per queue with its processor, every payload
// validated again before it runs (an invalid one fails at once, never retried), a deadline per run, the kill switch
// as a delay (the job waits, it is not lost or failed — T4.7), failures logged and reported on their last attempt,
// and the schedulers in Asia/Kolkata. Only the worker entrypoint (and tests) start it.
import type { DbHandle } from '@mc/db';
import { type Clock, systemClock } from '@mc/shared/clock';
import { DelayedError, type Job, type JobsOptions, UnrecoverableError, Worker } from 'bullmq';
import type { Redis } from 'ioredis';

import type { createLogger } from '../logger.ts';
import type { CdnPurger } from '../media/cdn-purge.ts';
import type { SendLedger } from '../push/ledger.ts';
import type { PushSender } from '../push/sender.ts';
import { alertService } from '../queue/alerts.ts';
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
import { processCampaignClose } from './campaigns/close.ts';
import { processMediaAccess } from './cdn/media-access.ts';
import { processCdnPurge } from './cdn/purge.ts';
import { processPaymentActivate } from './payments/activate.ts';
import { processFanout, PushPausedError } from './push/fanout.ts';
import { processSendBatch } from './push/send-batch.ts';
import { processOutboxSweep } from './push/sweeper.ts';
import { processSlaAlerts } from './reports/sla-alerts.ts';
import { processReportTriage } from './reports/triage.ts';
import { processRetention, type RetentionDeps } from './retention/run.ts';

type Logger = ReturnType<typeof createLogger>;

/** How long a paused job waits before it looks at the kill switch again. */
export const PAUSE_RECHECK_MS = 60_000;
/** Jobs of one queue running at once in this process (send batches each keep 50 requests in flight). */
export const DEFAULT_CONCURRENCY: Readonly<Record<JobName, number>> = {
  'push-fanout': 2,
  'push-send-batch': 4,
  'alert-send': 2,
  'outbox-sweeper': 1,
  'cdn-purge': 1,
  'media-access': 1,
  'sla-alerts': 1,
  'report-triage': 1,
  'payment-activate': 1,
  'campaign-close': 1,
  retention: 1,
};
/** Schedulers (01 §5.8), cron in India time. */
export const SCHEDULES: readonly { readonly job: JobName; readonly pattern: string }[] = [
  { job: 'outbox-sweeper', pattern: '* * * * *' },
  { job: 'report-triage', pattern: '* * * * *' },
  { job: 'sla-alerts', pattern: '*/15 * * * *' },
  { job: 'payment-activate', pattern: '*/10 * * * *' },
  { job: 'campaign-close', pattern: '10 0 * * *' },
  { job: 'retention', pattern: '0 3 * * *' },
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
  /** Cloudflare purge by tag for takedowns (T8.2); absent locally (nothing in front to purge). */
  readonly cdnPurger?: CdnPurger | undefined;
  /** `retention`'s media part (PHASE_06 T6.4): the worker's media store, the CDN purger, env MEDIA_ORIGIN. */
  readonly retention?: Pick<RetentionDeps, 'media' | 'purger' | 'mediaOrigin' | 'privateFiles'>;
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
      case 'cdn-purge':
        return processCdnPurge({ purger: deps.cdnPurger, logger: deps.logger }, parseJobPayload(name, data));
      case 'media-access': {
        const payload = parseJobPayload(name, data);
        return processMediaAccess(
          {
            db: deps.db,
            media: deps.retention?.media,
            purger: deps.cdnPurger,
            mediaOrigin: deps.retention?.mediaOrigin,
            logger: deps.logger,
          },
          payload,
        );
      }
      case 'sla-alerts':
        parseJobPayload(name, data);
        return processSlaAlerts({ ...common, queues, report: deps.report });
      case 'report-triage':
        parseJobPayload(name, data);
        return processReportTriage({ ...common, queues });
      case 'payment-activate':
        parseJobPayload(name, data);
        return processPaymentActivate({ ...common, queues });
      case 'campaign-close':
        parseJobPayload(name, data);
        return processCampaignClose(common);
      case 'retention':
        return processRetention(
          { ...common, ...deps.retention, alerts: alertService(queues, deps.logger) },
          parseJobPayload(name, data),
        );
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
