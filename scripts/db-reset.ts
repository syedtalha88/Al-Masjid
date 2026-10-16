// `pnpm db:reset` — local Docker MongoDB only (CLAUDE.md §7): drop the dev database, re-create the four application
// users with the passwords from `.env.local.compose` (02 §4.3, T1.1), then run every migration as mc_migrator (T1.2).
// The dev seed (fake masjids per 10 §5) joins with the features that need it. Never prints a password.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resetLocalDatabase } from '@mc/db';
import { migrateDatabase } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';

const root = fileURLToPath(new URL('..', import.meta.url));
for (const file of ['.env.local.compose', '.env.local.migrate']) {
  const path = join(root, file);
  if (existsSync(path)) process.loadEnvFile(path);
}
const env = process.env;
const need = (name: string): string => {
  const value = env[name];
  if (!value) throw new Error(`${name} is missing — run \`pnpm setup:local\` first`);
  return value;
};

const database = env['MONGODB_DB_NAME'] ?? 'masjid_connect_dev';
const rootUri = `mongodb://root:${encodeURIComponent(need('MONGO_ROOT_PASSWORD'))}@localhost:27018/?directConnection=true&authSource=admin`;
await resetLocalDatabase(rootUri, database, [
  { user: 'mc_public', password: need('MC_PUBLIC_PASSWORD') },
  { user: 'mc_admin', password: need('MC_ADMIN_PASSWORD') },
  { user: 'mc_system', password: need('MC_SYSTEM_PASSWORD') },
  { user: 'mc_migrator', password: need('MC_MIGRATOR_PASSWORD') },
]);
const { applied } = await migrateDatabase(need('MONGODB_URI_MIGRATOR'), database, MIGRATIONS);
process.stdout.write(
  `db:reset — ${database} dropped; 4 users applied; ${String(applied.length)} migrations applied.\n`,
);
