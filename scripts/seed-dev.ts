// `pnpm db:seed` — the dev seed (PHASE_02 T2.2) into the LOCAL Docker database only: 3 fake masjids (follow codes
// TESTA001 / TESTB002 / TESTC003), placeholder library entries (10 §5), 8 notice templates and 30 items, written as
// mc_system. Idempotent; `pnpm db:reset` runs it after the migrations. Never prints a password.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDbHandle, systemScope } from '@mc/db';
import { buildDevSeed, SEED_FOLLOW_CODES, writeDevSeed } from '@mc/db/seed';
import { calendarDateInZone } from '@mc/domain/time';

const root = fileURLToPath(new URL('..', import.meta.url));
for (const file of ['.env.local.worker']) {
  const path = join(root, file);
  if (existsSync(path)) process.loadEnvFile(path);
}
const uri = process.env['MONGODB_URI_SYSTEM'];
if (!uri) throw new Error('MONGODB_URI_SYSTEM is missing — run `pnpm setup:local` first');
const host = new URL(uri).hostname;
if (!['localhost', '127.0.0.1', 'mongo'].includes(host)) throw new Error('db:seed only writes to the local database');

const database = process.env['MONGODB_DB_NAME'] ?? 'masjid_connect_dev';
const handle = createDbHandle({ uri, database, process: 'script', local: true });
try {
  const now = new Date();
  const written = await writeDevSeed(handle, systemScope(), buildDevSeed({ now, today: calendarDateInZone(now) }));
  process.stdout.write(
    `db:seed — ${String(written)} documents in ${database}; follow codes ${Object.values(SEED_FOLLOW_CODES).join(', ')}.\n`,
  );
} finally {
  await handle.close();
}
