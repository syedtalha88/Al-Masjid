// `pnpm db:reset` — local Docker MongoDB only (CLAUDE.md §7): drop the dev database and re-create the four
// application users with the passwords from `.env.local.compose` (02 §4.3, PHASE_01 T1.1). Migrations and the dev
// seed join in T1.2. Never prints a password.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resetLocalDatabase } from '@mc/db';

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
process.stdout.write(`db:reset — ${database} dropped; users mc_public, mc_admin, mc_system, mc_migrator applied.\n`);
