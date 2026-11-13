// `push-send-batch` (01 §5.3 steps 3–4, PHASE_04 T4.4): one locale's group of a fan-out page. Loads the devices'
// subscriptions in one query, builds the notification once in that locale, sends with concurrency 50 and handles the
// answers: accepted → recorded in the Redis sent-set at once (a retry never re-sends), 404 / 410 → subscription dead,
// 429 / 5xx / network → the batch is retried by BullMQ (backoff) for the devices still unsent. On the batch's last run
// its result is counted onto the job exactly once.
import { type DbHandle, parseId, systemScope } from '@mc/db';
import {
  getFanoutJob,
  getPushContent,
  getPushSubscriptions,
  isPushPaused,
  markSubscriptionsDead,
  type PushSubscriptionRow,
  recordBatchResult,
} from '@mc/db/state';
import type { Clock } from '@mc/shared/clock';

import type { createLogger } from '../../logger.ts';
import type { SendLedger } from '../../push/ledger.ts';
import { pushMessage, pushOptions } from '../../push/message.ts';
import type { PushOutcome, PushSender } from '../../push/sender.ts';
import { type JobPayload, sendBatchJobId } from '../../queue/jobs.ts';
import { PushPausedError } from './fanout.ts';

type Logger = ReturnType<typeof createLogger>;

/** 01 §5.3 step 3: sends in flight per batch. */
export const SEND_CONCURRENCY = 50;
/** The kill switch is read again before every this many sends — a pause stops a big batch within one round (F64). */
export const PAUSE_CHECK_EVERY = 100;

export interface SendBatchDeps {
  readonly db: DbHandle;
  readonly ledger: SendLedger;
  readonly sender: PushSender;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Sends per kill-switch check ({@link PAUSE_CHECK_EVERY}; tests use a smaller round). */
  readonly pauseCheckEvery?: number;
}

/** Some sends should be tried again later; BullMQ retries the batch (only the unsent devices are sent then). */
export class PushRetryError extends Error {
  readonly pending: number;
  constructor(pending: number) {
    super(`push batch: ${String(pending)} sends to retry`);
    this.name = 'PushRetryError';
    this.pending = pending;
  }
}

export interface SendBatchResult {
  readonly sent: number;
  readonly failed: number;
  readonly pruned: number;
  readonly counted: boolean;
}

/** Runs `task` over `items` with at most `limit` running at once. */
async function eachLimited<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

/**
 * Records a batch's result exactly once: claims it in the ledger, then writes the job's counters. When the write fails
 * the claim is released and the error rethrown, so BullMQ's retry records it — a lost claim would leave the job's
 * balance above 0 for good (DECISIONS #140).
 *
 * @returns whether this call recorded the batch (false: an earlier run already had).
 * @throws the database error of the counter write (the claim is released first).
 */
async function countOnce(
  deps: Pick<SendBatchDeps, 'db' | 'ledger' | 'clock'>,
  jobId: NonNullable<ReturnType<typeof parseId>>,
  batch: { readonly jobKey: string; readonly batchId: string },
  result: { readonly sent: number; readonly failed: number; readonly pruned: number },
): Promise<boolean> {
  if (!(await deps.ledger.claimBatch(batch.jobKey, batch.batchId))) return false;
  try {
    await recordBatchResult(deps.db, systemScope(), jobId, result, deps.clock.now());
  } catch (error) {
    await deps.ledger.releaseBatch(batch.jobKey, batch.batchId);
    throw error;
  }
  return true;
}

/**
 * Sends one batch.
 *
 * @param attempt.final - BullMQ's last attempt: no retry is left, so unsent devices count as failed now.
 * @throws PushPausedError while the kill switch is on; PushRetryError when sends should be retried (not final).
 */
export async function processSendBatch(
  deps: SendBatchDeps,
  payload: JobPayload<'push-send-batch'>,
  attempt: { readonly final: boolean },
): Promise<SendBatchResult> {
  const scope = systemScope();
  const jobId = parseId(payload.jobId);
  const none = { sent: 0, failed: 0, pruned: 0, counted: false };
  if (!jobId) return none;
  if (await isPushPaused(deps.db, scope)) throw new PushPausedError();
  const job = await getFanoutJob(deps.db, scope, jobId);
  if (job?.status !== 'running') return none; // failed by the detector, or unknown: nothing more is sent
  const batchId = sendBatchJobId(payload.jobId, payload.page, payload.locale);

  const content = await getPushContent(deps.db, scope, job.itemId);
  if (!content?.published) {
    // Deleted or removed while sending: stop, and count the batch off so the job can finish.
    const counted = await countOnce(deps, jobId, { jobKey: payload.jobId, batchId }, { sent: 0, failed: 0, pruned: 0 });
    return { ...none, counted };
  }
  const message = JSON.stringify(pushMessage(content, payload.locale));
  const options = pushOptions(content);

  const deviceIds = payload.deviceIds.flatMap((text) => {
    const id = parseId(text);
    return id ? [id] : [];
  });
  const subscriptions = await getPushSubscriptions(deps.db, scope, {
    deviceIds,
    masjidId: job.masjidId,
    targets: job.audienceTargets,
  });
  const already = await deps.ledger.sentAlready(
    payload.jobId,
    subscriptions.map((row) => row.deviceId.toHexString(true)),
  );
  const todo = subscriptions.filter((row) => !already.has(row.deviceId.toHexString(true)));

  let sentNow = 0;
  let rejected = 0;
  const retry: PushSubscriptionRow[] = [];
  const gone: { deviceId: PushSubscriptionRow['deviceId']; endpoint: string }[] = [];
  const round = Math.max(1, deps.pauseCheckEvery ?? PAUSE_CHECK_EVERY);
  const sendOne = async (row: PushSubscriptionRow) => {
    const outcome: PushOutcome = await deps.sender.send(row, message, options);
    switch (outcome.kind) {
      case 'sent':
        await deps.ledger.markSent(payload.jobId, [row.deviceId.toHexString(true)]);
        sentNow += 1;
        break;
      case 'gone':
        gone.push({ deviceId: row.deviceId, endpoint: row.endpoint });
        break;
      case 'retry':
        retry.push(row);
        break;
      case 'rejected':
        rejected += 1;
        if (outcome.status === 413) deps.logger.error({ jobId: payload.jobId }, 'push payload too large (413)');
        break;
    }
  };
  for (let start = 0; start < todo.length; start += round) {
    // F64: paused mid-batch → stop now. Sent devices are in the ledger, so the resumed batch sends only the rest.
    if (start > 0 && (await isPushPaused(deps.db, scope))) {
      await markSubscriptionsDead(deps.db, scope, gone, deps.clock.now(), jobId);
      throw new PushPausedError();
    }
    await eachLimited(todo.slice(start, start + round), SEND_CONCURRENCY, sendOne);
  }
  const pruned = await markSubscriptionsDead(deps.db, scope, gone, deps.clock.now(), jobId);
  if (rejected > 0) deps.logger.warn({ jobId: payload.jobId, rejected }, 'push service refused some sends');

  if (retry.length > 0 && !attempt.final) throw new PushRetryError(retry.length);

  // The batch's last run: count it once. Sent = every device of the batch in the sent-set (earlier runs included).
  const sent = already.size + sentNow;
  const failed = retry.length + rejected;
  const counted = await countOnce(deps, jobId, { jobKey: payload.jobId, batchId }, { sent, failed, pruned: 0 });
  return { sent, failed, pruned, counted };
}
