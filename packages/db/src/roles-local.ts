// Local applier for 02 §4.3 (PHASE_01 T1.1): creates or updates the custom roles and users with `createRole` /
// `createUser` on the Docker MongoDB (`pnpm db:reset`) and in tests. Atlas forbids these commands on every tier — the
// Atlas applier uses the Admin API (`roles-atlas.ts`). Idempotent: running it again updates privileges and passwords.
import { MongoClient } from 'mongodb';

import { type DbUser, roleName, rolePrivileges } from './roles.ts';

export interface LocalDbUser {
  /** Which privilege set (02 §4.3). */
  readonly user: DbUser;
  /** Login name; defaults to `user` (tests use suffixed names so parallel files never collide). */
  readonly login?: string;
  /** Never logged or returned. */
  readonly password: string;
}

/** The privileges of `user` in MongoDB's `createRole` format, all targeting `database`. */
export function mongoPrivileges(
  user: DbUser,
  database: string,
): { resource: { db: string; collection: string }; actions: string[] }[] {
  return rolePrivileges(user).map(({ namespace, actions }) => ({
    resource: { db: database, collection: namespace ?? '' },
    actions: [...actions],
  }));
}

const isCode = (error: unknown, code: number) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code;

/**
 * Creates or updates one custom role + user per entry, privileges limited to `database`.
 *
 * @param client - connected as a user allowed to manage users/roles (local root).
 * @param database - the application database the privileges apply to.
 * @param users - which users to create; passwords are only sent to the server.
 * @throws on any server error other than "already exists" (which switches to update).
 */
export async function applyLocalRoles(client: MongoClient, database: string, users: readonly LocalDbUser[]) {
  const admin = client.db('admin');
  for (const { user, login = user, password } of users) {
    const role = roleName(login, database);
    const privileges = mongoPrivileges(user, database);
    try {
      await admin.command({ createRole: role, privileges, roles: [] });
    } catch (error) {
      if (!isCode(error, 51002)) throw error; // RoleAlreadyExists
      await admin.command({ updateRole: role, privileges, roles: [] });
    }
    const roles = [{ role, db: 'admin' }];
    try {
      await admin.command({ createUser: login, pwd: password, roles, mechanisms: ['SCRAM-SHA-256'] });
    } catch (error) {
      if (!isCode(error, 51003)) throw error; // UserAlreadyExists
      await admin.command({ updateUser: login, pwd: password, roles, mechanisms: ['SCRAM-SHA-256'] });
    }
  }
}

/**
 * Drops the users and their roles created by {@link applyLocalRoles} (tests clean up after themselves).
 *
 * @param logins - the login names used when applying.
 */
export async function dropLocalRoles(client: MongoClient, database: string, logins: readonly string[]) {
  const admin = client.db('admin');
  for (const login of logins) {
    await admin.command({ dropUser: login }).catch((error: unknown) => {
      if (!isCode(error, 11)) throw error; // UserNotFound
    });
    await admin.command({ dropRole: roleName(login, database) }).catch((error: unknown) => {
      if (!isCode(error, 31)) throw error; // RoleNotFound
    });
  }
}

/**
 * `pnpm db:reset` (local Docker only): drops `database`, then (re)creates the four application users for it.
 * Migrations and the dev seed are added by later tasks (PHASE_01 T1.2).
 *
 * @param rootUri - local root connection string (from `.env.local.compose`); refused unless it targets localhost.
 * @throws when the URI is not a localhost URI — this must never run against Atlas.
 */
export async function resetLocalDatabase(rootUri: string, database: string, users: readonly LocalDbUser[]) {
  const host = new URL(rootUri).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') throw new Error(`db:reset refuses non-local host ${host}`);
  const client = new MongoClient(rootUri, { serverSelectionTimeoutMS: 5000, appName: 'mc-db-reset' });
  try {
    await client.connect();
    await client.db(database).dropDatabase();
    await applyLocalRoles(client, database, users);
  } finally {
    await client.close();
  }
}
