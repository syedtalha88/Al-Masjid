// `cdn-purge` (01 §5.2, PHASE_08 T8.2): after a takedown or restore commits, api-admin enqueues the post's and the
// masjid's cache tags; the worker (the only process with the Cloudflare purge token) asks Cloudflare to drop every
// cached response carrying them, so a removed post's old detail URL answers "gone" within a minute. A refusal or rate
// limit throws — BullMQ retries with backoff; purging twice is harmless.
import type { createLogger } from '../../logger.ts';
import type { CdnPurger } from '../../media/cdn-purge.ts';
import type { JobPayload } from '../../queue/jobs.ts';

export interface CdnPurgeDeps {
  /** Absent locally: nothing is in front to purge (logged, done). */
  readonly purger: CdnPurger | undefined;
  readonly logger: ReturnType<typeof createLogger>;
}

/**
 * One purge.
 *
 * @returns whether Cloudflare was asked.
 * @throws Error when Cloudflare refused or could not be reached (the job retries).
 */
export async function processCdnPurge(
  deps: CdnPurgeDeps,
  payload: JobPayload<'cdn-purge'>,
): Promise<{ readonly purged: boolean }> {
  if (!deps.purger) {
    deps.logger.info({ tags: payload.tags.length }, 'cdn purge skipped: no CDN purger configured');
    return { purged: false };
  }
  await deps.purger.purgeTags(payload.tags);
  return { purged: true };
}
