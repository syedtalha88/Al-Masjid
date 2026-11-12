// `retention` (01 §5.8, 02 §6): daily at 03:00 IST the worker (`mc_system`) deletes what its retention period has
// ended for. So far: needy people 90 days after they were fulfilled, closed or deleted, with their amount history
// (PHASE_05 T5.8, DECISIONS #104); the admin alert subscriptions whose session has ended (F65, DECISIONS #159); posts
// deleted or removed 180 days ago, with their media files and CDN copies (PHASE_06 T6.4 — `media-delete`). The other
// collections' periods (02 §6) join here in Phase 8. Idempotent — a missed run is the next run's work. Logs counts
// only, never who or which file.
import { type DbHandle, systemScope } from '@mc/db';
import { pruneAdminPushSubscriptions, purgeBeneficiaries, purgeExpiredItems } from '@mc/db/state';
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
 * Posts deleted / removed 180 days ago (02 §6, PHASE_06 T6.4): the documents first (one transaction each), then their
 * files in storage and every delivery URL at the CDN. A storage or CDN failure throws after the documents are gone, so
 * BullMQ retries the job; the next attempt finds no more documents for those files — they are logged as left behind
 * (counts only) and Phase 8's orphan sweep (T8.7) catches them.
 */
async function purgeItems(deps: RetentionDeps, now: Date): Promise<{ purged: number; mediaFiles: number }> {
  const { purged, media } = await purgeExpiredItems(deps.db, systemScope(), { now });
  const files = media.images.length + media.audio.length;
  if (purged > 0) deps.logger.info({ items: purged, mediaFiles: files }, 'retention: deleted posts purged');
  if (files === 0) return { purged, mediaFiles: 0 };
  if (!deps.media) {
    deps.logger.warn({ mediaFiles: files }, 'retention: no media store — files left in storage');
    return { purged, mediaFiles: 0 };
  }
  for (const key of media.images) await deps.media.deleteImage(key);
  for (const key of media.audio) await deps.media.deleteAudio(key);
  if (deps.purger && deps.mediaOrigin) await deps.purger.purge(mediaDeliveryUrls(deps.mediaOrigin, media));
  return { purged, mediaFiles: files };
}
