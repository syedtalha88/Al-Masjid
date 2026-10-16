// `@mc/db/migrate` — runner + snapshot helpers (PHASE_01 T1.2).
export { checkSchema, migrateDatabase } from './cli.ts';
export { schemaDrift } from './drift.ts';
export { type Migration, MigrationError, type MigrationResult, runMigrations } from './runner.ts';
export {
  applySnapshot,
  currentSnapshot,
  parseSnapshot,
  sameIndex,
  type SchemaSnapshot,
  snapshotChecksum,
  snapshotText,
} from './snapshot.ts';
