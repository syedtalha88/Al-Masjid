// `pnpm bootstrap:super-admin --name "<display name>" [--locale en|hi|ur|te] [--force-additional]` — LOCAL Docker
// MongoDB only (04 §3, PHASE_01 T1.9). Creates the first Super Admin as the system DB user and prints a one-time
// invite link (72 h). Refuses when a Super Admin already exists unless --force-additional. The server-side one-off
// is decided in DECISIONS #70. Never prints a connection string, the pepper or anything but the link.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BOOTSTRAP_USAGE, bootstrapSuperAdminInvite, parseBootstrapArgs } from '@mc/api/jobs/bootstrap-super-admin';
import { createDbHandle, StateError } from '@mc/db';

const root = fileURLToPath(new URL('..', import.meta.url));
// System DB user from the worker's file; pepper + admin origin from the api-admin's (local files only).
for (const file of ['.env.local.worker', '.env.local.api-admin']) {
  const path = join(root, file);
  if (existsSync(path)) process.loadEnvFile(path);
}
const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing — run \`pnpm setup:local\` first`);
  return value;
};

const options = parseBootstrapArgs(process.argv.slice(2));
if ('error' in options) {
  process.stderr.write(`${options.error}\n${BOOTSTRAP_USAGE}\n`);
  process.exit(2);
}
if (need('APP_ENV') !== 'local' || !/@(localhost|127\.0\.0\.1)[:/]/.test(need('MONGODB_URI_SYSTEM'))) {
  process.stderr.write('bootstrap-super-admin (pnpm) runs against the local Docker MongoDB only.\n');
  process.exit(2);
}

const handle = createDbHandle({
  uri: need('MONGODB_URI_SYSTEM'),
  database: need('MONGODB_DB_NAME'),
  process: 'script',
  local: true,
});
try {
  const { inviteUrl, expiresAt } = await bootstrapSuperAdminInvite(handle, {
    ...options,
    adminOrigin: need('ADMIN_ORIGIN'),
    pepper: Buffer.from(need('SESSION_PEPPER'), 'base64'),
  });
  process.stdout.write(
    `Super Admin "${options.displayName}" created.\nOne-time invite link (valid until ${expiresAt.toISOString()}):\n${inviteUrl}\n`,
  );
} catch (error) {
  if (error instanceof StateError && error.code === 'SUPER_ADMIN_EXISTS') {
    process.stderr.write('A Super Admin already exists. Use --force-additional to add another one.\n');
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await handle.close();
}
