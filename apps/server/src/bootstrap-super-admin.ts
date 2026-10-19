// Entrypoint: `deploy.sh <env> --bootstrap-super-admin --name "<name>" [--locale …] [--force-additional]` runs this in a
// one-off api-admin container (PHASE_01 T1.9, DECISIONS #70 option A): the api-admin's own DB user (mc_admin may
// insert admin_users / admin_invites / audit_log) and its SESSION_PEPPER, which the login hashes invite tokens with —
// no other process ever holds the pepper. Prints the one-time invite link to the owner's terminal only; never a
// connection string or the pepper. Exit 1 when refused (a Super Admin exists), 2 on bad arguments.
import { BOOTSTRAP_USAGE, bootstrapSuperAdminInvite, parseBootstrapArgs } from '@mc/api/jobs/bootstrap-super-admin';
import { createDbHandle, StateError } from '@mc/db';

import { bootEnv } from './lifecycle.ts';

const options = parseBootstrapArgs(process.argv.slice(2));
if ('error' in options) {
  process.stderr.write(`${options.error}\n${BOOTSTRAP_USAGE}\n`);
  process.exit(2);
}

const env = bootEnv('api-admin', process);
const handle = createDbHandle({
  uri: env.MONGODB_URI_ADMIN,
  database: env.MONGODB_DB_NAME,
  process: 'api-admin',
  local: env.APP_ENV === 'local',
});
try {
  const { inviteUrl, expiresAt } = await bootstrapSuperAdminInvite(handle, {
    ...options,
    adminOrigin: env.ADMIN_ORIGIN,
    pepper: Buffer.from(env.SESSION_PEPPER, 'base64'),
  });
  process.stdout.write(
    `Super Admin "${options.displayName}" created.\nOne-time invite link (valid until ${expiresAt.toISOString()}) — open it on the phone that will hold the passkey, share it with nobody:\n${inviteUrl}\n`,
  );
} catch (error) {
  if (error instanceof StateError && error.code === 'SUPER_ADMIN_EXISTS') {
    process.stderr.write('A Super Admin already exists. Use --force-additional to add another one.\n');
    process.exitCode = 1;
  } else {
    process.stderr.write(`bootstrap failed: ${error instanceof Error ? error.name : 'unknown error'}\n`);
    process.exitCode = 1;
  }
} finally {
  await handle.close();
}
