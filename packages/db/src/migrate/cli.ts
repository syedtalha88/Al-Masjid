// Connection-owning wrappers for the migration commands (`pnpm db:migrate`, `pnpm db:schema:check`, the server
// image's `migrate` entry): callers pass a URI and never import the driver (the `mongodb` import ban, CLAUDE.md §6).
import { MongoClient } from 'mongodb';

import { schemaDrift } from './drift.ts';
import { type Migration, type MigrationResult, runMigrations } from './runner.ts';

async function withDatabase<T>(uri: string, appName: string, fn: (client: MongoClient) => Promise<T>) {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10_000,
    appName,
    w: 'majority',
    readConcernLevel: 'majority',
  });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.close();
  }
}

/**
 * Applies pending migrations to `database`.
 *
 * @param uri - the migrator's connection string (`MONGODB_URI_MIGRATOR`; never printed).
 * @throws MigrationError (lock held, checksum changed) or any server error.
 */
export function migrateDatabase(
  uri: string,
  database: string,
  migrations: readonly Migration[],
): Promise<MigrationResult> {
  return withDatabase(uri, 'migrate', (client) => runMigrations(client.db(database), migrations));
}

/**
 * The drift between `database` and the current schema (empty = in sync).
 *
 * @param uri - a connection string whose user may list collections and indexes (the migrator's).
 */
export function checkSchema(uri: string, database: string): Promise<string[]> {
  return withDatabase(uri, 'schema-check', (client) => schemaDrift(client.db(database)));
}
