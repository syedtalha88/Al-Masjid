// BullMQ job definitions (01 §5.8, PHASE_04 T4.1): queue names, payload schemas, default options. Shared by the API
// (which only enqueues — after a commit) and the worker's processors in `jobs/` (which validate again before doing
// anything). Lives outside `jobs/` so API code never imports job code (DECISIONS #88, #89). No HTTP route can create a
// job: the only producers are the publish routes' after-commit hook and the worker itself (04 R7).
import { ADMIN_ALERT_TYPES } from '@mc/shared/contracts/push';
import type { JobsOptions } from 'bullmq';
import { z } from 'zod';

/** The BullMQ key prefix (Redis ACL `~bull:*` for api-admin and worker — infra/vps/make-env.sh). */
export const QUEUE_PREFIX = 'bull';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const locale = z.enum(['en', 'hi', 'ur', 'te']);

/** 01 §5.3 step 3: at most 1,000 devices per batch. */
export const SEND_BATCH_SIZE = 1000;

export const JOB_SCHEMAS = {
  /** Fan a pending `notification_jobs` document out to send batches. */
  'push-fanout': z.strictObject({ jobId: uuid }),
  /** Send one locale's page of a fan-out. */
  'push-send-batch': z.strictObject({
    jobId: uuid,
    page: z.int().min(0).max(100_000),
    locale,
    deviceIds: z.array(uuid).min(1).max(SEND_BATCH_SIZE),
  }),
  /** One admin / Super Admin alert push (T4.6): what happened, never free text. */
  'alert-send': z.strictObject({
    alertId: z.string().regex(/^[A-Za-z0-9_.-]{1,120}$/),
    to: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('super') }),
      z.strictObject({ kind: z.literal('admins'), adminIds: z.array(uuid).min(1).max(20) }),
    ]),
    alert: z.strictObject({
      type: z.enum(ADMIN_ALERT_TYPES),
      params: z.record(z.string().regex(/^[a-z][A-Za-z]{0,30}$/), z.union([z.string().max(120), z.int()])).default({}),
    }),
  }),
  /** Scheduled every minute: re-enqueue lost outbox jobs, fail stuck ones (01 §5.3 step 7). */
  'outbox-sweeper': z.strictObject({}),
  /** After a takedown / restore (T8.2): purge the post's and masjid's cached responses (`i-<publicId>`, `m-<id>`). */
  'cdn-purge': z.strictObject({
    tags: z
      .array(z.string().regex(/^[im]-[A-Za-z0-9_-]{1,40}$/))
      .min(1)
      .max(10),
  }),
  /** After a takedown / restore (F73): the post's files stop (or start again) being delivered. */
  'media-access': z.strictObject({ itemId: uuid, restrict: z.boolean() }),
  /** Scheduled every 15 minutes: Super Admin alerts at 50 / 80 / 100 % of each SLA (05 §3, PHASE_08 T8.3). */
  'sla-alerts': z.strictObject({}),
  /** Scheduled every minute: urgent-report alerts and auto-hide after many reports (05 §3, PHASE_08 T8.1). */
  'report-triage': z.strictObject({}),
  /** Scheduled every 10 minutes: approved UPI details whose hold has passed go live (04 R1, T5.2). */
  'payment-activate': z.strictObject({}),
  /** Scheduled daily 00:10 IST: donation drives whose end date has passed close (00 §4.3, T5.3). */
  'campaign-close': z.strictObject({}),
  /** Scheduled daily 03:00 IST: data whose retention period has ended is deleted (02 §6; T5.8: needy people). */
  /** `dryRun` (T8.7): counts only, changes nothing — the Super Admin's ★ "Retention dry run". */
  retention: z.strictObject({ dryRun: z.boolean().optional() }),
} as const;

export type JobName = keyof typeof JOB_SCHEMAS;
export type JobPayload<N extends JobName> = z.output<(typeof JOB_SCHEMAS)[N]>;
export type JobInput<N extends JobName> = z.input<(typeof JOB_SCHEMAS)[N]>;

/** One queue per job, so each gets its own concurrency (01 §5.8). Names never contain ":" (BullMQ). */
export const JOB_NAMES = Object.keys(JOB_SCHEMAS) as readonly JobName[];

const DAY_S = 24 * 60 * 60;
/** Completed jobs stay a day (BullMQ job-id dedup covers duplicate enqueues meanwhile); failed ones a week. */
const REMOVAL = { removeOnComplete: { age: DAY_S }, removeOnFail: { age: 7 * DAY_S } } as const;

/** Defaults per job (attempts, exponential backoff in ms — BullMQ waits `delay × 2^(attempt−1)`). */
export const JOB_DEFAULTS: Readonly<Record<JobName, JobsOptions>> = {
  'push-fanout': { attempts: 5, backoff: { type: 'exponential', delay: 5_000 }, ...REMOVAL },
  // A send batch lists device ids of one masjid's followers: failed ones go after a day too (security review L10, #142).
  'push-send-batch': {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10_000 },
    ...REMOVAL,
    removeOnFail: { age: DAY_S },
  },
  'alert-send': { attempts: 5, backoff: { type: 'exponential', delay: 30_000 }, ...REMOVAL },
  'outbox-sweeper': { attempts: 1, removeOnComplete: { count: 10 }, removeOnFail: { count: 100 } },
  // Cloudflare Free allows 5 tag purges a minute: back off over minutes; purging twice is harmless.
  'cdn-purge': { attempts: 8, backoff: { type: 'exponential', delay: 15_000 }, ...REMOVAL },
  'media-access': { attempts: 8, backoff: { type: 'exponential', delay: 15_000 }, ...REMOVAL },
  // Idempotent and scheduled: a failed run is simply the next run's work.
  'sla-alerts': { attempts: 1, removeOnComplete: { count: 10 }, removeOnFail: { count: 100 } },
  'report-triage': { attempts: 1, removeOnComplete: { count: 10 }, removeOnFail: { count: 100 } },
  'payment-activate': { attempts: 1, removeOnComplete: { count: 10 }, removeOnFail: { count: 100 } },
  'campaign-close': { attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, ...REMOVAL },
  retention: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, ...REMOVAL },
};

/** The longest one run of a job may take before it counts as failed (BullMQ has no job timeout of its own). */
export const JOB_TIMEOUT_MS: Readonly<Record<JobName, number>> = {
  'push-fanout': 120_000,
  // 1,000 sends at concurrency 50 = 20 rounds of at most the 10 s push request deadline.
  'push-send-batch': 240_000,
  'alert-send': 60_000,
  'outbox-sweeper': 50_000,
  'cdn-purge': 30_000,
  'media-access': 120_000,
  'sla-alerts': 120_000,
  'report-triage': 50_000,
  'payment-activate': 120_000,
  'campaign-close': 120_000,
  retention: 600_000,
};

/** The BullMQ job id of a send batch — dedups a duplicated fan-out (01 §5.8; "." instead of ":", which BullMQ refuses). */
export const sendBatchJobId = (jobId: string, page: number, locale: string): string =>
  `${jobId}.${String(page)}.${locale}`;

/**
 * Validates a job payload.
 *
 * @throws InvalidJobPayloadError naming the job (never the values — they may be device ids).
 */
export function parseJobPayload<N extends JobName>(name: N, data: unknown): JobPayload<N> {
  const result = JOB_SCHEMAS[name].safeParse(data);
  if (!result.success) throw new InvalidJobPayloadError(name);
  return result.data as JobPayload<N>; // validated just above by the schema of `name`
}

export class InvalidJobPayloadError extends Error {
  readonly job: JobName;
  constructor(job: JobName) {
    super(`invalid ${job} job payload`);
    this.name = 'InvalidJobPayloadError';
    this.job = job;
  }
}
