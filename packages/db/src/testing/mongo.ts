// `@mc/db/testing` — per-test-file MongoDB databases for integration tests (10 §3, PHASE_00 T0.12).
// Test code only: nothing under src/ outside testing/ may import this module.
import { randomBytes } from 'node:crypto';

import { type Db, MongoClient } from 'mongodb';

/** Database names created here start with this, so leftovers are recognisable and safe to drop. */
export const TEST_DATABASE_PREFIX = 'test_';
/** MongoDB's database-name limit is 64 bytes. */
const MAX_NAME = 63;

export interface TestDatabase {
  readonly client: MongoClient;
  readonly db: Db;
  readonly name: string;
  /** Drops the database and closes the client (idempotent). */
  dispose(): Promise<void>;
}

/** The test connection string, or a clear instruction when it is missing. */
export function testMongoUri(env: NodeJS.ProcessEnv = process.env): string {
  const uri = env['MONGODB_URI_TEST'];
  if (!uri) {
    throw new Error(
      'MONGODB_URI_TEST is not set. Start the local services (`pnpm db:start`), run `pnpm setup:local`, and use ' +
        '`pnpm test:int` (it loads .env.local.test).',
    );
  }
  return uri;
}

/**
 * A unique database name for one test file: `test_<label>_<pid>_<random>`, ≤ 63 characters, only
 * `[a-z0-9_]` (portable across MongoDB's naming rules).
 *
 * @param label - human hint, e.g. the file name.
 */
export function testDatabaseName(label: string): string {
  const slug = label
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
    .slice(0, 24);
  const suffix = `${String(process.pid)}_${randomBytes(4).toString('hex')}`;
  return `${TEST_DATABASE_PREFIX}${slug || 'db'}_${suffix}`.slice(0, MAX_NAME);
}

/**
 * Connects to the test MongoDB and reserves a fresh database for one test file.
 *
 * @throws when `MONGODB_URI_TEST` is missing or the server is unreachable (5 s).
 */
export async function createTestDatabase(label: string, uri: string = testMongoUri()): Promise<TestDatabase> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, appName: 'mc-tests' });
  await client.connect();
  const name = testDatabaseName(label);
  const db = client.db(name);
  let disposed = false;
  return {
    client,
    db,
    name,
    async dispose() {
      if (disposed) return;
      disposed = true;
      try {
        await db.dropDatabase();
      } finally {
        await client.close();
      }
    },
  };
}
