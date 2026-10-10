import { afterAll, beforeAll } from 'vitest';

import { createTestRedis, type TestRedis } from './redis.ts';

/**
 * Vitest hook: a Redis client with this test file's own key prefix; its keys are deleted after the last test.
 *
 * @param label - usually `import.meta.url`.
 * @returns a getter for the client (valid inside tests and later hooks).
 */
export function useTestRedis(label: string): () => TestRedis {
  let redis: TestRedis | undefined;
  beforeAll(async () => {
    redis = await createTestRedis(label);
  });
  afterAll(async () => {
    await redis?.dispose();
  });
  return () => {
    if (!redis) throw new Error('useTestRedis: the client is only available inside tests');
    return redis;
  };
}
