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
}

/** The purge service over the job queues; `null` queues (unit tests, no Redis) make it report `false`. */
export function cdnPurgeService(queues: JobQueues | null, logger: Logger): CdnPurgeService {
  return {
    async purgeTags(tags, key) {
      if (queues === null) return false;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await queues.enqueue('cdn-purge', { tags: [...tags] }, { jobId: `cdn.${key}`.slice(0, 120) });
          return true;
        } catch (error) {
          logger.error({ err: error, attempt }, 'cdn purge not enqueued');
        }
      }
      return false;
    },
  };
}
