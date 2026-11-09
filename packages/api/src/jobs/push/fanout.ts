// `push-fanout` (01 §5.3 step 2, PHASE_04 T4.4): pages through the masjid's notifying followers in device-id order
// (keyset, 1,000 a page), groups each page by locale and hands every group to `push-send-batch` (BullMQ job id
// `<job>.<page>.<locale>` — a duplicated or retried fan-out adds nothing twice). Progress is stored on the job after
// each page, so a retry resumes where the last run stopped. Runs in the worker as `systemScope()`.
import { type DbHandle, parseId, systemScope } from '@mc/db';
import {
  beginFanout,
  completeIfDone,
  failJob,
  fanoutPage,
  type FanoutRecipient,
  getFanoutJob,
  getPushContent,
  isPushPaused,
  type PushLocale,
  recordFanoutPage,
} from '@mc/db/state';
import type { Clock } from '@mc/shared/clock';

import type { createLogger } from '../../logger.ts';
import { type JobPayload, SEND_BATCH_SIZE, sendBatchJobId } from '../../queue/jobs.ts';
import type { JobQueues } from '../../queue/queues.ts';

type Logger = ReturnType<typeof createLogger>;

/** The kill switch is on (T4.7): the processor wrapper delays the job — it is neither lost nor failed. */
export class PushPausedError extends Error {
  constructor() {
    super('push is paused');
    this.name = 'PushPausedError';
  }
}

export interface FanoutDeps {
  readonly db: DbHandle;
  readonly queues: JobQueues;
  readonly clock: Clock;
  readonly logger: Logger;
}

export type FanoutResult =
  | { readonly outcome: 'fanned-out'; readonly pages: number; readonly targeted: number }
  | { readonly outcome: 'skipped'; readonly reason: 'unknown-job' | 'not-runnable' | 'item-gone' };

/** One page's recipients, grouped by the language their notification is written in. */
function byLocale(rows: readonly FanoutRecipient[]): Map<PushLocale, string[]> {
  const groups = new Map<PushLocale, string[]>();
  for (const row of rows) {
    const group = groups.get(row.locale) ?? [];
    group.push(row.deviceId.toHexString(true));
    groups.set(row.locale, group);
  }
  return groups;
}

/**
 * Fans the outbox job out.
 *
 * @throws PushPausedError while the kill switch is on (before any page, or between pages).
 */
export async function processFanout(deps: FanoutDeps, payload: JobPayload<'push-fanout'>): Promise<FanoutResult> {
  const scope = systemScope();
  const jobId = parseId(payload.jobId);
  if (!jobId) return { outcome: 'skipped', reason: 'unknown-job' };
  if (await isPushPaused(deps.db, scope)) throw new PushPausedError();

  let job = await beginFanout(deps.db, scope, jobId, deps.clock.now());
  if (!job) return { outcome: 'skipped', reason: 'unknown-job' };
  if (job.status !== 'running') return { outcome: 'skipped', reason: 'not-runnable' };

  const content = await getPushContent(deps.db, scope, job.itemId);
  if (!content?.published) {
    // Deleted, removed or its masjid suspended before anyone was notified: nothing is sent (00 §4.4).
    await failJob(deps.db, scope, jobId, 'item no longer published', deps.clock.now());
    return { outcome: 'skipped', reason: 'item-gone' };
  }

  let pages = 0;
  let targeted = 0;
  while (!job.fanoutDone) {
    if (pages > 0 && (await isPushPaused(deps.db, scope))) throw new PushPausedError();
    const rows = await fanoutPage(deps.db, scope, {
      masjidId: job.masjidId,
      targets: job.audienceTargets,
      after: job.fanoutCursor,
      limit: SEND_BATCH_SIZE,
    });
    const groups = byLocale(rows);
    for (const [locale, deviceIds] of groups) {
      await deps.queues.enqueue(
        'push-send-batch',
        { jobId: payload.jobId, page: job.fanoutPage, locale, deviceIds },
        { jobId: sendBatchJobId(payload.jobId, job.fanoutPage, locale) },
      );
    }
    await recordFanoutPage(
      deps.db,
      scope,
      jobId,
      {
        page: job.fanoutPage,
        cursor: rows.at(-1)?.deviceId,
        batches: groups.size,
        targeted: rows.length,
        done: rows.length < SEND_BATCH_SIZE,
      },
      deps.clock.now(),
    );
    pages += 1;
    targeted += rows.length;
    const next = await getFanoutJob(deps.db, scope, jobId);
    if (next?.status !== 'running') return { outcome: 'skipped', reason: 'not-runnable' }; // failed meanwhile
    job = next;
  }
  // No recipients at all (or every batch already counted off): the job completes here.
  await completeIfDone(deps.db, scope, jobId, deps.clock.now());
  deps.logger.info({ jobId: payload.jobId, pages, targeted }, 'push fan-out done');
  return { outcome: 'fanned-out', pages, targeted };
}
