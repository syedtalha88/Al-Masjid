import { describe, expect, it } from 'vitest';

import { createTestRedis, testRedisUrl } from '../src/testing/redis.ts';
import { useTestRedis } from '../src/testing/vitest.ts';

// T0.12: every integration test file works under its own Redis key prefix on the Docker Redis (ACL user
// `test`, `test:*` keys only) and leaves nothing behind.
const redis = useTestRedis(import.meta.url);

describe('per-file Redis prefixes', () => {
  it('keys are written under the file’s prefix and read back without it', async () => {
    const { redis: client, prefix } = redis();
    await client.set('counter', '1');
    await client.incr('counter');
    expect(await client.get('counter')).toBe('2');
    expect(prefix).toMatch(/^test:[a-z0-9-]+:\d+:[0-9a-f]{8}:$/);
  });

  it('another file’s client sees none of it; dispose removes its keys', async () => {
    const other = await createTestRedis('other');
    await other.redis.set('counter', '9');
    await other.redis.set('extra', 'x');
    expect(await other.redis.get('counter')).toBe('9');
    const otherPrefix = other.prefix;
    await other.dispose();
    const [, leftover] = await redis().redis.scan('0', 'MATCH', `${otherPrefix}*`, 'COUNT', 1000);
    expect(leftover).toEqual([]);
    expect(await redis().redis.get('counter')).toBe('2');
  });

  it('the test user cannot touch keys outside test:*', async () => {
    const { Redis } = await import('ioredis');
    const raw = new Redis(testRedisUrl(), { lazyConnect: true, maxRetriesPerRequest: 1 });
    await raw.connect();
    try {
      await expect(raw.set('rl:pub:not-mine', '1')).rejects.toThrow(/NOPERM/);
    } finally {
      await raw.quit();
    }
  });
});
