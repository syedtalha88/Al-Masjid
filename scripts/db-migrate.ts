// `pnpm db:migrate` / `pnpm db:schema:check` — local Docker MongoDB, as mc_migrator (02 §4.3, PHASE_01 T1.2).
//   node scripts/db-migrate.ts            apply pending migrations (idempotent)
//   node scripts/db-migrate.ts --check    compare the live schema with src/schema; exit 1 on drift
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkSchema, migrateDatabase } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';

const root = fileURLToPath(new URL('..', import.meta.url));
const envFile = join(root, '.env.local.migrate');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const uri = process.env['MONGODB_URI_MIGRATOR'];
const database = process.env['MONGODB_DB_NAME'] ?? 'masjid_connect_dev';
if (!uri) throw new Error('MONGODB_URI_MIGRATOR is missing — run `pnpm setup:local` first');

if (process.argv.includes('--check')) {
  const drift = await checkSchema(uri, database);
  if (drift.length > 0) {
    process.stderr.write(`db:schema:check — ${database} drifted:\n${drift.map((line) => `  ${line}`).join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write(`db:schema:check — ${database} matches the schema\n`);
} else {
  const { applied, skipped } = await migrateDatabase(uri, database, MIGRATIONS);
  process.stdout.write(
    `db:migrate — ${database}: ${String(applied.length)} applied, ${String(skipped.length)} already applied\n`,
  );
  for (const id of applied) process.stdout.write(`  + ${id}\n`);
}
