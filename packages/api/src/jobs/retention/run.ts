// `retention` (01 §5.8, 02 §6, PHASE_08 T8.7): daily at 03:00 IST the worker (`mc_system`) deletes what its retention
// period has ended for — every row of 02 §6: posts deleted or removed 180 days ago with their media files and CDN
// copies (T6.4); needy people (T5.8); admin alert subscriptions of ended sessions (F65); and the rest through
// `runRetention` (devices, report device ids, dead push addresses, admin sessions / invites, reports, grievances,
// audit log, notification jobs, push quota, campaign amount history, removed admins, stats, deleted contacts), deleted
// Ruqyah entries with their recordings, and closed legal orders with their encrypted documents. Files go first, the
// documents after; anything whose file could not be deleted waits for the next attempt (the job then fails: BullMQ
// retries and Sentry hears, and the Super Admin gets a `retention_failed` alert). A time budget keeps a run inside the
// job timeout; the next run carries on. `dryRun` (Super Admin, ★) counts and changes nothing. Every run writes an
// audited summary (counts only). Logs counts only, never who or which file.
import { type DbHandle, systemScope } from '@mc/db';
import {
  deleteExpiredItem,
  deleteExpiredLegalOrder,
  deleteExpiredRuqyah,
  listExpiredItems,
  listExpiredLegalOrders,
  listExpiredRuqyah,
  pruneAdminPushSubscriptions,
  purgeBeneficiaries,
  recordRetentionRun,
  type RetentionCounts,
  runRetention,
} from '@mc/db/state';
import type { Clock } from '@mc/shared/clock';

import type { createLogger } from '../../logger.ts';
import { type CdnPurger, mediaDeliveryUrls } from '../../media/cdn-purge.ts';
import type { PrivateFileStore } from '../../media/private-store.ts';
import type { MediaStore } from '../../media/store.ts';
import type { AlertService } from '../../queue/alerts.ts';

/** Wall-clock budget of one run: inside the job's 10-minute timeout, with room for the summary. */
export const RETENTION_BUDGET_MS = 8 * 60 * 1000;

export interface RetentionDeps {
  readonly db: DbHandle;
  readonly clock: Clock;
  readonly logger: ReturnType<typeof createLogger>;
  /** Where media files live (the worker's own Cloudinary key); absent → files are left (logged). */
  readonly media?: MediaStore | undefined;
  /** The CDN in front of the media origin; absent → nothing to purge (local). */
  readonly purger?: CdnPurger | undefined;
  /** env MEDIA_ORIGIN — the delivery URLs to purge. */
  readonly mediaOrigin?: string | undefined;
  /** Encrypted legal-order documents (T8.5); absent → orders with a document wait. */
  readonly privateFiles?: PrivateFileStore | undefined;
  /** The Super Admin's `retention_failed` alert. */
  readonly alerts?: AlertService | undefined;
  /** Injectable wall clock for the budget (tests). */
  readonly wallNow?: () => number;
}

export interface RetentionResult {
  readonly dryRun: boolean;
  readonly counts: RetentionCounts;
  /** Files deleted (media + recordings + documents). */
  readonly files: number;
  /** The time budget ended before everything was done (the next run carries on). */
  readonly partial: boolean;
}

/**
 * One run of the job.
 *
 * @param payload.dryRun - count what is due, change nothing (the summary is still audited, marked as a dry run).
 * @throws Error when some files could not be deleted (their documents wait; BullMQ retries) — after the summary.
 */
export async function processRetention(
  deps: RetentionDeps,
  payload: { readonly dryRun?: boolean | undefined } = {},
): Promise<RetentionResult> {
  const scope = systemScope();
  const now = deps.clock.now();
  const dryRun = payload.dryRun === true;
  const wallNow = deps.wallNow ?? Date.now;
  const deadline = new Date(wallNow() + RETENTION_BUDGET_MS);
  const counts: RetentionCounts = {};
  let files = 0;
  let failed = 0;
  try {
    if (dryRun) {
      counts['items'] = (await listExpiredItems(deps.db, scope, { now })).length;
    } else {
      counts['beneficiaries'] = await purgeBeneficiaries(deps.db, scope, { now });
      counts['alertSubscriptions'] = await pruneAdminPushSubscriptions(deps.db, scope, now);
      const items = await purgeItems(deps, now);
      counts['items'] = items.purged;
      files += items.mediaFiles;
      failed += items.failedFiles;
    }
    Object.assign(counts, await runRetention(deps.db, scope, { now, dryRun, deadline }));

    // Deleted Ruqyah entries (30 days), recording first.
    const ruqyah = await listExpiredRuqyah(deps.db, scope, { now });
    counts['ruqyah'] = 0;
    if (dryRun) counts['ruqyah'] = ruqyah.length;
    else {
      for (const entry of ruqyah) {
        if (entry.audioKey) {
          const key = entry.audioKey;
          if (!deps.media || !(await attempt(() => deps.media?.deleteAudio(key)))) {
            failed += 1;
            continue;
          }
          files += 1;
        }
        if (await deleteExpiredRuqyah(deps.db, scope, entry.id)) counts['ruqyah'] += 1;
      }
    }

    // Closed legal orders (3 years), encrypted document first.
    const orders = await listExpiredLegalOrders(deps.db, scope, { now });
    counts['legalOrders'] = 0;
    if (dryRun) counts['legalOrders'] = orders.length;
    else {
      for (const order of orders) {
        if (order.documentKey) {
          const key = order.documentKey;
          if (!deps.privateFiles || !(await attempt(() => deps.privateFiles?.delete(key)))) {
            failed += 1;
            continue;
          }
          files += 1;
        }
        if (await deleteExpiredLegalOrder(deps.db, scope, order.id)) counts['legalOrders'] += 1;
      }
    }
  } catch (error) {
    await alertFailure(deps, now);
    throw error;
  }

  const partial = wallNow() >= deadline.getTime();
  await recordRetentionRun(deps.db, scope, { dryRun, counts, files, partial });
  const nonZero = Object.fromEntries(Object.entries(counts).filter(([, value]) => value > 0));
  deps.logger.info({ dryRun, ...nonZero, files, partial }, dryRun ? 'retention: dry run' : 'retention: run done');
  // A file that could not be deleted keeps its record — only stores that exist can fail (local without a store waits).
  if (failed > 0 && (deps.media || deps.privateFiles)) {
    deps.logger.warn({ waiting: failed }, 'retention: records kept — files not deleted');
    await alertFailure(deps, now);
    throw new Error('retention: some files could not be deleted; their records wait for the next attempt');
  }
  return { dryRun, counts, files, partial };
}

/** The Super Admin's alert (one per day — the key is the date). Never throws: the job's own error matters more. */
async function alertFailure(deps: RetentionDeps, now: Date): Promise<void> {
  try {
    await deps.alerts?.raise({
      type: 'retention_failed',
      to: { kind: 'super' },
      key: now.toISOString().slice(0, 10),
    });
  } catch {
    deps.logger.warn({}, 'retention: failure alert not queued');
  }
}

/**
 * Posts deleted / removed 180 days ago (02 §6, PHASE_06 T6.4, security review #165 M1): for every due post its own
 * files are deleted first (carrying on past a failed file), then the CDN copies of all of them are purged in one go,
 * and only then are the documents of the posts whose files are all gone deleted. Anything that failed keeps its
 * document, so the next attempt / run does the whole post again (deleting a missing file and purging twice are
 * harmless).
 */
async function purgeItems(
  deps: RetentionDeps,
  now: Date,
): Promise<{ purged: number; mediaFiles: number; failedFiles: number }> {
  const due = await listExpiredItems(deps.db, systemScope(), { now });
  if (due.length === 0) return { purged: 0, mediaFiles: 0, failedFiles: 0 };
  const store = deps.media;
  const ready: typeof due = [];
  let failedFiles = 0;
  for (const item of due) {
    const files = item.media.images.length + item.media.audio.length;
    if (files > 0 && !store) {
      failedFiles += files; // no store configured (local): the post waits — nothing is stranded
      continue;
    }
    let ok = true;
    for (const key of item.media.images) {
      ok = (await attempt(() => store?.deleteImage(key))) && ok;
    }
    for (const key of item.media.audio) {
      ok = (await attempt(() => store?.deleteAudio(key))) && ok;
    }
    if (ok) ready.push(item);
    else failedFiles += files;
  }
  const media = {
    images: ready.flatMap((item) => item.media.images),
    audio: ready.flatMap((item) => item.media.audio),
  };
  const mediaFiles = media.images.length + media.audio.length;
  if (mediaFiles > 0 && deps.purger && deps.mediaOrigin) {
    await deps.purger.purge(mediaDeliveryUrls(deps.mediaOrigin, media)); // throws → no document deleted, retried
  }
  let purged = 0;
  for (const item of ready) {
    if (await deleteExpiredItem(deps.db, systemScope(), { itemId: item.id, now })) purged += 1;
  }
  if (failedFiles > 0) {
    deps.logger.warn(
      { items: due.length - ready.length, mediaFiles: failedFiles },
      'retention: posts kept — files not deleted',
    );
  }
  return { purged, mediaFiles, failedFiles: store ? failedFiles : 0 };
}

/** Runs one storage call; false when it failed (the caller keeps the record for the next attempt). */
async function attempt(call: () => Promise<void> | undefined): Promise<boolean> {
  try {
    await call();
    return true;
  } catch {
    return false;
  }
}
