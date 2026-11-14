// Asking for a CDN purge from api-admin (PHASE_08 T8.2): the API only enqueues — the worker holds the purge token.
import type { createLogger } from '../logger.ts';
import type { JobQueues } from './queues.ts';

type Logger = ReturnType<typeof createLogger>;

export interface CdnPurgeService {
  /**
   * Enqueues a purge of these cache tags, trying three times. Never throws.
   *
   * @param key - what makes this purge unique (`[A-Za-z0-9_.-]`), e.g. `<publicId>.<ms>` — the same key enqueues once.
   * @returns whether it was enqueued (`false` → the Super Admin is told and can clear the cache again).
   */
  purgeTags(tags: readonly string[], key: string): Promise<boolean>;
  /**
   * Enqueues a purge of a masjid's cached responses (`m-<id>`) for a frequent, routine change (needy list — #180 M7),
   * merged per masjid per {@link MASJID_PURGE_WINDOW_MS}: one delayed job at the end of the window covers every change
   * made in it (each change was committed before the job runs). Prioritised below takedowns, so a busy day of edits
   * never holds back the purge of a removed post (security re-review N-M1). Never throws; failures are logged.
   *
   * @returns whether it was enqueued (or already queued for this window).
   */
  purgeMasjidSoon(masjidId: string, now: Date): Promise<boolean>;
  /**
   * Enqueues a check of a post's files (F73): restricted while the post is not published, delivered while it is — the
   * worker reads the status (security review M1). Tries three times. Never throws.
   *
   * @returns whether it was enqueued.
   */
  mediaAccess(itemId: string, key: string): Promise<boolean>;
  /**
   * Enqueues a retention dry run (PHASE_08 T8.7, ★ Super Admin): the worker counts what is due and audits the summary.
   *
   * @returns whether it was enqueued.
   */
  retentionDryRun?(key: string): Promise<boolean>;
}

/** Routine masjid purges are merged over this window (one Cloudflare request per masjid per window at most). */
export const MASJID_PURGE_WINDOW_MS = 10_000;
/**
 * BullMQ priority of merged routine purges. Jobs without a priority (takedowns, restores, masjid status changes) always
 * run before prioritised ones; the worker's limiter keeps the queue under Cloudflare's tag-purge budget.
 */
export const ROUTINE_PURGE_PRIORITY = 10;

/** The purge service over the job queues; `null` queues (unit tests, no Redis) make it report `false`. */
export function cdnPurgeService(queues: JobQueues | null, logger: Logger): CdnPurgeService {
  const tryThrice = async (what: string, enqueue: () => Promise<unknown>) => {
    if (queues === null) return false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await enqueue();
        return true;
      } catch (error) {
        logger.error({ err: error, attempt }, `${what} not enqueued`);
      }
    }
    return false;
  };
  return {
    purgeTags: (tags, key) =>
      tryThrice(
        'cdn purge',
        () =>
          queues?.enqueue('cdn-purge', { tags: [...tags] }, { jobId: `cdn.${key}`.slice(0, 120) }) ?? Promise.resolve(),
      ),
    purgeMasjidSoon: (masjidId, now) => {
      const at = now.getTime();
      const window = Math.floor(at / MASJID_PURGE_WINDOW_MS);
      return tryThrice('cdn purge', () => {
        if (!queues) return Promise.resolve();
        return queues.enqueue(
          'cdn-purge',
          { tags: [`m-${masjidId}`] },
          {
            jobId: `cdn.m.${masjidId}.${String(window)}`,
            delayMs: (window + 1) * MASJID_PURGE_WINDOW_MS - at,
            priority: ROUTINE_PURGE_PRIORITY,
          },
        );
      });
    },
    mediaAccess: (itemId, key) =>
      tryThrice(
        'media access',
        () => queues?.enqueue('media-access', { itemId }, { jobId: `media.${key}`.slice(0, 120) }) ?? Promise.resolve(),
      ),
    retentionDryRun: (key) =>
      tryThrice(
        'retention dry run',
        () =>
          queues?.enqueue('retention', { dryRun: true }, { jobId: `retention.dry.${key}`.slice(0, 120) }) ??
          Promise.resolve(),
      ),
  };
}
