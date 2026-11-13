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
