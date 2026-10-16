// `db:verify-roles` (02 §4.3, PHASE_01 T1.1): a READ-ONLY check, run inside each process's container with that
// process's own credentials, that MongoDB grants exactly the privileges of 02 §4.3 — via `connectionStatus`
// (`showPrivileges`), never by writing. Capability probes: views readable without their source (mc_public), a
// read-only transaction. Prints names and verdicts only, never a connection string.
import { MongoClient } from 'mongodb';

import { clientOptions } from './client.ts';
import { DB_USERS, type DbUser, rolePrivileges } from './roles.ts';

export interface RoleCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

/** The environment variable holding each user's connection string (per-process env files, DECISIONS #7). */
export const URI_VARIABLE: Readonly<Record<DbUser, string>> = {
  mc_public: 'MONGODB_URI_PUBLIC',
  mc_admin: 'MONGODB_URI_ADMIN',
  mc_system: 'MONGODB_URI_SYSTEM',
  mc_migrator: 'MONGODB_URI_MIGRATOR',
};

/** Which user a process's environment authenticates as (exactly one URI variable must be present). */
export function userFromEnv(env: Readonly<Record<string, string | undefined>>): { user: DbUser; uri: string } {
  const present = DB_USERS.filter((user) => env[URI_VARIABLE[user]]);
  const [user] = present;
  if (present.length !== 1 || !user)
    throw new Error(`expected exactly one MongoDB URI variable, found ${String(present.length)}`);
  return { user, uri: env[URI_VARIABLE[user]] ?? '' };
}

type PrivilegeList = { resource: { db?: string; collection?: string }; actions: string[] }[];

const key = (collection: string, action: string) => `${collection || '(database)'}:${action}`;

/**
 * Compares the effective privileges of the connected user in `database` with 02 §4.3 and runs read-only probes.
 *
 * @param uri - the process's own connection string.
 * @param options.local - true for the Docker MongoDB (no TLS); `options.login` - expected login (default: the user).
 * @returns one check per aspect; `ok: false` lists missing/extra privileges by name.
 */
export async function verifyRoles(
  uri: string,
  database: string,
  user: DbUser,
  options: { local?: boolean; login?: string } = {},
): Promise<RoleCheck[]> {
  const { local = false, login = user } = options;
  const client = new MongoClient(uri, { ...clientOptions({ process: 'script', local }), minPoolSize: 0 });
  const checks: RoleCheck[] = [];
  try {
    await client.connect();
    const db = client.db(database);
    const status = await client.db('admin').command({ connectionStatus: 1, showPrivileges: true });
    const authInfo = (status['authInfo'] ?? {}) as {
      authenticatedUsers?: { user: string }[];
      authenticatedUserPrivileges?: PrivilegeList;
    };
    const who = authInfo.authenticatedUsers?.map((u) => u.user) ?? [];
    checks.push({ name: `authenticated as ${login}`, ok: who.length === 1 && who[0] === login, detail: who.join(',') });

    const live = new Set(
      (authInfo.authenticatedUserPrivileges ?? [])
        .filter((p) => p.resource.db === database)
        .flatMap((p) => p.actions.map((action) => key(p.resource.collection ?? '', action))),
    );
    const want = new Set(
      rolePrivileges(user).flatMap((p) => p.actions.map((action) => key(p.namespace ?? '', action))),
    );
    const missing = [...want].filter((k) => !live.has(k)).sort();
    const extra = [...live].filter((k) => !want.has(k)).sort();
    checks.push({
      name: `privileges in ${database} match 02 §4.3`,
      ok: missing.length === 0 && extra.length === 0,
      detail:
        [...missing.map((k) => `missing ${k}`), ...extra.map((k) => `extra ${k}`)].join('; ') ||
        `${String(want.size)} privileges`,
    });
    const otherDatabases = (authInfo.authenticatedUserPrivileges ?? []).filter(
      (p) => p.resource.db !== database && p.resource.db !== undefined && p.actions.length > 0,
    );
    checks.push({
      name: 'no privileges on any other database',
      ok: otherDatabases.length === 0,
      detail: otherDatabases.map((p) => p.resource.db ?? '').join(','),
    });

    // Capability probes — reads only.
    if (user === 'mc_public') {
      const view = await db
        .collection('v_pub_settings')
        .findOne({})
        .then(
          () => true,
          () => false,
        );
      const source = await db
        .collection('app_settings')
        .findOne({})
        .then(
          () => true,
          () => false,
        );
      checks.push({ name: 'reads a view without privileges on its source (T1.1 (2))', ok: view && !source });
    }
    const session = client.startSession();
    try {
      const probe = user === 'mc_migrator' ? '_migrations' : user === 'mc_public' ? 'v_pub_settings' : 'app_settings';
      await session.withTransaction(async (tx) => {
        await db.collection(probe).findOne({}, { session: tx });
      });
      checks.push({ name: 'read-only transaction commits (T1.1 (3))', ok: true });
    } catch (error) {
      checks.push({
        name: 'read-only transaction commits (T1.1 (3))',
        ok: false,
        detail: error instanceof Error ? error.name : 'error',
      });
    } finally {
      await session.endSession();
    }
  } catch (error) {
    checks.push({
      name: 'connect',
      ok: false,
      detail: error instanceof Error ? `${error.name}: ${error.message}` : 'error',
    });
  } finally {
    await client.close();
  }
  return checks;
}
