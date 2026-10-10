// `@mc/api/testing` — per-test-file Redis key prefixes for integration tests (10 §3, PHASE_00 T0.12).
// Test code only. The local `test` Redis user may only touch `test:*` keys (pnpm setup:local).
import { randomBytes } from 'node:crypto';

import { Redis } from 'ioredis';

export interface TestRedis {
  /** A client whose every key is transparently prefixed (ioredis `keyPrefix`). */
  readonly redis: Redis;
  /** `test:<label>:<pid>:<random>:` — also what BullMQ queues should use as their `prefix`. */
  readonly prefix: string;
  /** Deletes every key under the prefix and disconnects (idempotent). */
  dispose(): Promise<void>;
}

/** The test connection string, or a clear instruction when it is missing. */
export function testRedisUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env['REDIS_URL_TEST'];
  if (!url) {
    throw new Error(
      'REDIS_URL_TEST is not set. Start the local services (`pnpm db:start`), run `pnpm setup:local`, and use ' +
        '`pnpm test:int` (it loads .env.local.test).',
    );
  }
  return url;
}

/** A unique key prefix for one test file. */
export function testRedisPrefix(label: string): string {
  const slug = label
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(-32);
  return `test:${slug || 'redis'}:${String(process.pid)}:${randomBytes(4).toString('hex')}:`;
}

/**
 * Connects a prefixed Redis client for one test file.
 *
 * @throws when `REDIS_URL_TEST` is missing or Redis is unreachable.
 */
export async function createTestRedis(label: string, url: string = testRedisUrl()): Promise<TestRedis> {
  const prefix = testRedisPrefix(label);
  const redis = new Redis(url, { keyPrefix: prefix, lazyConnect: true, maxRetriesPerRequest: 1 });
  await redis.connect();
  let disposed = false;
  return {
    redis,
    prefix,
    async dispose() {
      if (disposed) return;
      disposed = true;
      // SCAN matches the raw key names (ioredis does not prefix SCAN patterns); DEL re-adds the prefix, so
      // strip it before deleting.
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
        cursor = next;
        if (keys.length > 0) await redis.del(...keys.map((key) => key.slice(prefix.length)));
      } while (cursor !== '0');
      await redis.quit();
    },
  };
}
