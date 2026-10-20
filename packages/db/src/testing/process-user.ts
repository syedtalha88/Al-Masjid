// A database handle that connects as one of the real 02 §4.3 users (test code only): API route tests run through it,
// so a state function that needs a privilege the process does not have fails in the test — not first on staging
// (PHASE_01: masjid creation as mc_admin, 20 Oct 2026).
import { randomBytes } from 'node:crypto';

import { createDbHandle, type DbHandle, type DbProcess } from '../client.ts';
import type { DbUser } from '../roles.ts';
import { applyLocalRoles, dropLocalRoles } from '../roles-local.ts';
import { type TestDatabase, testMongoUri } from './mongo.ts';

const PROCESS_OF: Readonly<Record<DbUser, DbProcess>> = {
  mc_public: 'api-public',
  mc_admin: 'api-admin',
  mc_system: 'worker',
  mc_migrator: 'migrate',
};

/**
 * Creates a temporary login with `user`'s privileges on the test database and a handle that uses it.
 *
 * @returns the handle and `dispose` (closes it and drops the login).
 */
export async function processUserHandle(
  test: TestDatabase,
  user: DbUser,
): Promise<{ handle: DbHandle; dispose(): Promise<void> }> {
  const login = `${user}_t${randomBytes(3).toString('hex')}`;
  const password = randomBytes(24).toString('base64url');
  await applyLocalRoles(test.client, test.name, [{ user, login, password }]);
  const url = new URL(testMongoUri());
  url.username = login;
  url.password = password;
  const handle = createDbHandle({ uri: url.toString(), database: test.name, process: PROCESS_OF[user], local: true });
  return {
    handle,
    async dispose() {
      await handle.close();
      await dropLocalRoles(test.client, test.name, [login]);
    },
  };
}
