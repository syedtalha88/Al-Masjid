// `retention` (01 §5.8, 02 §6): daily at 03:00 IST the worker (`mc_system`) deletes what its retention period has
// ended for. So far: needy people 90 days after they were fulfilled, closed or deleted, with their amount history
// (PHASE_05 T5.8, DECISIONS #104); the admin alert subscriptions whose session has ended (F65, DECISIONS #159); posts
// deleted or removed 180 days ago, with their media files and CDN copies (PHASE_06 T6.4 — `media-delete`). The other
// collections' periods (02 §6) join here in Phase 8. Idempotent — a missed run is the next run's work. Logs counts
// only, never who or which file.
import { type DbHandle, systemScope } from '@mc/db';
import { deleteExpiredItem, listExpiredItems, pruneAdminPushSubscriptions, purgeBeneficiaries } from '@mc/db/state';
import type { Clock } from '@mc/shared/clock';

import type { createLogger } from '../../logger.ts';
import { type CdnPurger, mediaDeliveryUrls } from '../../media/cdn-purge.ts';
import type { MediaStore } from '../../media/store.ts';

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
}

/**
 * One run: purges every needy person whose `purge_after` has passed, and every admin alert subscription whose session
 * no longer carries alerts.
 */
export async function processRetention(
  deps: RetentionDeps,
): Promise<{ beneficiaries: number; alertPhones: number; items: number; mediaFiles: number }> {
  const now = deps.clock.now();
  const beneficiaries = await purgeBeneficiaries(deps.db, systemScope(), { now });
  if (beneficiaries > 0) deps.logger.info({ beneficiaries }, 'retention: needy people purged');
  const alertPhones = await pruneAdminPushSubscriptions(deps.db, systemScope(), now);
  if (alertPhones > 0)
    deps.logger.info({ alertPhones }, 'retention: admin alert subscriptions without a session removed');
  const { purged: items, mediaFiles } = await purgeItems(deps, now);
  return { beneficiaries, alertPhones, items, mediaFiles };
}

/**
 * Posts deleted / removed 180 days ago (02 §6, PHASE_06 T6.4, security review #165 M1): for every due post its own
 * files are deleted first (carrying on past a failed file), then the CDN copies of all of them are purged in one go,
 * and only then are the documents of the posts whose files are all gone deleted. Anything that failed keeps its
 * document, so the next attempt / run does the whole post again (deleting a missing file and purging twice are
 * harmless); the job then fails, so BullMQ retries and the failure is reported.
 */
async function purgeItems(deps: RetentionDeps, now: Date): Promise<{ purged: number; mediaFiles: number }> {
  const due = await listExpiredItems(deps.db, systemScope(), { now });
  if (due.length === 0) return { purged: 0, mediaFiles: 0 };
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
  if (purged > 0) deps.logger.info({ items: purged, mediaFiles }, 'retention: deleted posts purged');
  if (failedFiles > 0) {
    deps.logger.warn(
      { items: due.length - ready.length, mediaFiles: failedFiles },
      'retention: posts kept — files not deleted',
    );
    if (store)
      throw new Error('retention: some media files could not be deleted; their posts wait for the next attempt');
  }
  return { purged, mediaFiles };
}

/** Runs one storage call; false when it failed (the caller keeps the post for the next attempt). */
async function attempt(call: () => Promise<void> | undefined): Promise<boolean> {
  try {
    await call();
    return true;
  } catch {
    return false;
  }
}
