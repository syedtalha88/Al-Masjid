// Producing jobs (PHASE_04 T4.1): typed, validated enqueue onto one BullMQ queue per job name, and the after-commit
// hand-over of a publish's outbox job (01 §5.3 step 1). A lost hand-over (Redis down, process killed) is not an error:
// the job is already `pending` in MongoDB and the outbox sweeper enqueues it within ~2 minutes.
import { type JobsOptions, Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import type { createLogger } from '../logger.ts';
import { JOB_DEFAULTS, type JobInput, type JobName, parseJobPayload, QUEUE_PREFIX } from './jobs.ts';

type Logger = ReturnType<typeof createLogger>;

export interface JobQueues {
  /**
   * Validates `payload` and adds it. With `jobId`, a job that still exists under that id is not added again (BullMQ
   * dedup) — duplicate fan-outs and re-sweeps are free.
   *
   * @throws InvalidJobPayloadError (nothing is added), or Redis errors.
   */
  enqueue<N extends JobName>(
    name: N,
    payload: JobInput<N>,
    options?: { jobId?: string; delayMs?: number },
  ): Promise<void>;
  /** The queue of `name` (worker: schedulers, health counts, the sweeper's state checks). */
  queue(name: JobName): Queue;
  close(): Promise<void>;
}

/**
 * Producers for every job queue over one Redis connection (no ioredis `keyPrefix` — BullMQ prefixes keys itself).
 *
 * @param prefix - BullMQ key prefix; tests pass their per-file Redis prefix.
 */
export function createJobQueues(
  connection: Redis,
  prefix: string = QUEUE_PREFIX,
  /** Per-job option overrides (tests shorten the backoff). */
  overrides: Partial<Record<JobName, JobsOptions>> = {},
): JobQueues {
  const queues = new Map<JobName, Queue>();
  const queue = (name: JobName): Queue => {
    let existing = queues.get(name);
    if (!existing) {
      existing = new Queue(name, {
        connection,
        prefix,
        defaultJobOptions: { ...JOB_DEFAULTS[name], ...overrides[name] },
      });
      queues.set(name, existing);
    }
    return existing;
  };
  return {
    async enqueue(name, payload, options) {
      const data = parseJobPayload(name, payload);
      await queue(name).add(name, data, {
        ...(options?.jobId === undefined ? {} : { jobId: options.jobId }),
        ...(options?.delayMs === undefined ? {} : { delay: options.delayMs }),
      });
    },
    queue,
    async close() {
      await Promise.all([...queues.values()].map((entry) => entry.close()));
      queues.clear();
    },
  };
}

/** What a publish route needs to hand its outbox job to the worker. */
export interface PushNotifier {
  /** After the publish transaction committed: enqueue `push-fanout` for `jobId`. Never throws. */
  afterCommit(jobId: string | null): Promise<void>;
}

/** The notifier of api-admin; `null` queues (no Redis configured in a unit test) make it a no-op. */
export function pushNotifier(queues: JobQueues | null, logger: Logger): PushNotifier {
  return {
    async afterCommit(jobId) {
      if (jobId === null || queues === null) return;
      try {
        await queues.enqueue('push-fanout', { jobId }, { jobId });
      } catch (error) {
        // The outbox document is committed and pending: the sweeper picks it up (01 §5.3 step 7).
        logger.warn({ err: error, jobId }, 'push fan-out not enqueued; the outbox sweeper will');
      }
    },
  };
}
