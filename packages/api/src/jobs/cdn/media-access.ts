// `media-access` (F73, PHASE_08 T8.2): after a takedown commits, the removed post's files stop being delivered at once
// — moved to Cloudinary's `authenticated` type (kept privately for the 180-day preservation; never signed) and purged
// from Cloudflare by URL — instead of staying reachable by their old URL until the retention job deletes them. A
// restore moves them back. Only files no published post, masjid photo or Ruqyah recording still uses are restricted.
import { type DbHandle, parseId, systemScope } from '@mc/db';
import { mediaForTakedown } from '@mc/db/state';

import type { createLogger } from '../../logger.ts';
import { type CdnPurger, mediaDeliveryUrls } from '../../media/cdn-purge.ts';
import type { MediaStore } from '../../media/store.ts';
import type { JobPayload } from '../../queue/jobs.ts';

export interface MediaAccessDeps {
  readonly db: DbHandle;
  /** The worker's media store; absent → nothing to change (logged). */
  readonly media: MediaStore | undefined;
  readonly purger: CdnPurger | undefined;
  readonly mediaOrigin: string | undefined;
  readonly logger: ReturnType<typeof createLogger>;
}

/**
 * One takedown or restore of a post's files.
 *
 * @returns how many files changed access.
 * @throws Error when the store or the CDN refused (the job retries; both directions are idempotent).
 */
export async function processMediaAccess(
  deps: MediaAccessDeps,
  payload: JobPayload<'media-access'>,
): Promise<{ readonly files: number }> {
  const itemId = parseId(payload.itemId);
  if (!itemId) throw new Error('media-access: malformed item id'); // the payload schema already refuses it
  // The direction follows the post's status now, not the payload (M1): a late retry can never re-expose a removed post.
  const media = await mediaForTakedown(deps.db, systemScope(), { itemId });
  const files = media.images.length + media.audio.length;
  if (files === 0) return { files: 0 };
  if (!deps.media) {
    deps.logger.warn({ files }, 'media access unchanged: no media store configured');
    return { files: 0 };
  }
  for (const key of media.images) {
    await (media.restrict ? deps.media.restrictImage(key) : deps.media.unrestrictImage(key));
  }
  for (const key of media.audio) {
    await (media.restrict ? deps.media.restrictAudio(key) : deps.media.unrestrictAudio(key));
  }
  // Our CDN's copies of the delivery URLs go too (a restored file is simply fetched again).
  if (media.restrict && deps.purger && deps.mediaOrigin) {
    await deps.purger.purge(mediaDeliveryUrls(deps.mediaOrigin, media));
  }
  return { files };
}
