import { describe, expect, it } from 'vitest';

import { testRedisPrefix, testRedisUrl } from '../src/testing/redis.ts';

// Unit tests for the integration-test helpers (no Redis needed).
describe('Redis test helpers', () => {
  it('prefixes are test:-scoped, slugged and unique', () => {
    const prefix = testRedisPrefix('file:///C:/repo/packages/api/test/Rate Limits.int.test.ts');
    expect(prefix).toMatch(/^test:[a-z0-9-]+:\d+:[0-9a-f]{8}:$/);
    expect(testRedisPrefix('!!!')).toMatch(/^test:redis:/);
  });

  it('explains how to get REDIS_URL_TEST when it is missing', () => {
    expect(() => testRedisUrl({})).toThrow(/pnpm setup:local/);
    expect(testRedisUrl({ REDIS_URL_TEST: 'redis://x' })).toBe('redis://x');
  });
});
