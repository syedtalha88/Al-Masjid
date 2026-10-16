// `db:verify-roles` (PHASE_01 T1.1) against a real, migrated MongoDB: every user passes as itself; a user holding the
// wrong privileges is reported with the exact missing/extra privileges; nothing is written.
import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { DB_USERS, type DbUser } from '../src/roles.ts';
import { applyLocalRoles, dropLocalRoles } from '../src/roles-local.ts';
import { createTestDatabase, type TestDatabase, testMongoUri } from '../src/testing/index.ts';
import { userFromEnv, verifyRoles } from '../src/verify-roles.ts';

const suffix = randomBytes(3).toString('hex');
const login = (user: DbUser) => `${user}_v${suffix}`;
const password = randomBytes(24).toString('base64url');
const wrong = `mc_public_w${suffix}`;
let test: TestDatabase | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const uriFor = (name: string) => {
  const url = new URL(testMongoUri());
  url.username = name;
  url.password = password;
  return url.toString();
};

beforeAll(async () => {
  test = await createTestDatabase('verify_roles');
  await runMigrations(t().db, MIGRATIONS);
  await applyLocalRoles(t().client, t().name, [
    ...DB_USERS.map((user) => ({ user, login: login(user), password })),
    { user: 'mc_admin', login: wrong, password }, // mc_admin's privileges under a login checked as mc_public
  ]);
});

afterAll(async () => {
  if (test) {
    await dropLocalRoles(test.client, test.name, [...DB_USERS.map(login), wrong]);
    await test.dispose();
  }
});

describe('verifyRoles', () => {
  for (const user of DB_USERS) {
    it(`${user}: every check passes as itself`, async () => {
      const checks = await verifyRoles(uriFor(login(user)), t().name, user, { local: true, login: login(user) });
      expect(checks.filter((c) => !c.ok)).toEqual([]);
      expect(checks.length).toBeGreaterThanOrEqual(user === 'mc_public' ? 5 : 4);
    });
  }

  it('wrong privileges are reported by name (missing and extra)', async () => {
    const checks = await verifyRoles(uriFor(wrong), t().name, 'mc_public', { local: true, login: wrong });
    const privileges = checks.find((c) => c.name.startsWith('privileges'));
    expect(privileges?.ok).toBe(false);
    expect(privileges?.detail).toContain('missing devices:find');
    expect(privileges?.detail).toContain('extra items:find');
    // mc_admin can read app_settings, so the view-only property fails too
    expect(checks.find((c) => c.name.startsWith('reads a view'))?.ok).toBe(false);
  });

  it('an unreachable server is a failed check, not a crash; the URI is never in the output', async () => {
    const uri = `mongodb://u:s3cret@127.0.0.1:1/?serverSelectionTimeoutMS=500`;
    const checks = await verifyRoles(uri, 'x', 'mc_admin', { local: true });
    expect(checks).toEqual([expect.objectContaining({ name: 'connect', ok: false })]);
    expect(JSON.stringify(checks)).not.toContain('s3cret');
  });
});

describe('userFromEnv', () => {
  it('finds the single URI variable of a process', () => {
    expect(userFromEnv({ MONGODB_URI_ADMIN: 'mongodb://x' })).toEqual({ user: 'mc_admin', uri: 'mongodb://x' });
    expect(() => userFromEnv({})).toThrow(/exactly one/);
    expect(() => userFromEnv({ MONGODB_URI_ADMIN: 'a', MONGODB_URI_SYSTEM: 'b' })).toThrow(/exactly one/);
  });
});
