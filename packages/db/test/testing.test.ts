import { describe, expect, it } from 'vitest';

import { TEST_DATABASE_PREFIX, testDatabaseName, testMongoUri } from '../src/testing/mongo.ts';

// Unit tests for the integration-test helpers (no MongoDB needed).
describe('testDatabaseName', () => {
  it('is prefixed, portable, unique per call and within MongoDB’s 64-byte limit', () => {
    const name = testDatabaseName('file:///C:/repo/packages/api/test/Masjids Bundle.int.test.ts');
    expect(name.startsWith(TEST_DATABASE_PREFIX)).toBe(true);
    expect(name).toMatch(/^[a-z0-9_]+$/);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(testDatabaseName('x')).not.toBe(testDatabaseName('x'));
    expect(testDatabaseName('!!!')).toMatch(/^test_db_/);
  });

  it('explains how to get MONGODB_URI_TEST when it is missing', () => {
    expect(() => testMongoUri({})).toThrow(/pnpm setup:local/);
    expect(testMongoUri({ MONGODB_URI_TEST: 'mongodb://localhost' })).toBe('mongodb://localhost');
  });
});
