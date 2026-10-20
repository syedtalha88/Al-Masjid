// `@mc/db/testing` — integration-test helpers (test code only).
export {
  createTestDatabase,
  TEST_DATABASE_PREFIX,
  type TestDatabase,
  testDatabaseName,
  testMongoUri,
} from './mongo.ts';
export { processUserHandle } from './process-user.ts';
export { useTestDatabase } from './vitest.ts';
