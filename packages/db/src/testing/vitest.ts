import { afterAll, beforeAll } from 'vitest';

import { createTestDatabase, type TestDatabase } from './mongo.ts';

/**
 * Vitest hook: a fresh database for this test file, created before the first test and dropped after the
 * last (10 §3 "each test file uses its own database name … so files run in parallel").
 *
 * @param label - usually the file name (`import.meta.url`).
 * @returns a getter for the database (valid inside tests and later hooks).
 */
export function useTestDatabase(label: string): () => TestDatabase {
  let database: TestDatabase | undefined;
  beforeAll(async () => {
    database = await createTestDatabase(label);
  });
  afterAll(async () => {
    await database?.dispose();
  });
  return () => {
    if (!database) throw new Error('useTestDatabase: the database is only available inside tests');
    return database;
  };
}
