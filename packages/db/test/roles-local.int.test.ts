// The local applier's re-run behaviour (PHASE_01 T1.1): applying again updates privileges and passwords, dropping
// is idempotent, and `db:reset` refuses anything but localhost. Per-file logins never touch the dev users.
import { randomBytes } from 'node:crypto';

import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyLocalRoles, dropLocalRoles, resetLocalDatabase } from '../src/roles-local.ts';
import { createTestDatabase, type TestDatabase, testMongoUri } from '../src/testing/index.ts';

const login = `mc_admin_r${randomBytes(3).toString('hex')}`;
let test: TestDatabase | undefined;
const db = (): TestDatabase => {
  if (!test) throw new Error('test database not created');
  return test;
};

/** Tries to log in as `login` with `password`; true when the server accepts it. */
async function canLogIn(password: string): Promise<boolean> {
  const url = new URL(testMongoUri());
  url.username = login;
  url.password = password;
  const client = new MongoClient(url.toString(), { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    return true;
  } catch {
    return false;
  } finally {
    await client.close();
  }
}

beforeAll(async () => {
  test = await createTestDatabase('roles-local');
});

afterAll(async () => {
  if (test) {
    await dropLocalRoles(test.client, test.name, [login]);
    await test.dispose();
  }
});

describe('applyLocalRoles / dropLocalRoles', () => {
  it('a second apply updates the role and rotates the password', async () => {
    await applyLocalRoles(db().client, db().name, [{ user: 'mc_admin', login, password: 'first-password-123456' }]);
    expect(await canLogIn('first-password-123456')).toBe(true);
    await applyLocalRoles(db().client, db().name, [{ user: 'mc_public', login, password: 'second-password-123456' }]);
    expect(await canLogIn('first-password-123456')).toBe(false);
    expect(await canLogIn('second-password-123456')).toBe(true);
    const info = await db()
      .client.db('admin')
      .command({ rolesInfo: `${login}__${db().name}`, showPrivileges: true });
    // The role now carries mc_public's privileges: devices yes, items no.
    const privileges = JSON.stringify(info['roles']);
    expect(privileges).toContain('"collection":"devices"');
    expect(privileges).not.toContain('"collection":"items"');
  });

  it('dropping twice is a no-op the second time', async () => {
    await dropLocalRoles(db().client, db().name, [login]);
    await expect(dropLocalRoles(db().client, db().name, [login])).resolves.toBeUndefined();
    expect(await canLogIn('second-password-123456')).toBe(false);
  });
});

describe('resetLocalDatabase (pnpm db:reset)', () => {
  it('refuses a non-local MongoDB', async () => {
    await expect(
      resetLocalDatabase('mongodb+srv://root:x@mc-staging.example.mongodb.net/', 'masjid_connect', []),
    ).rejects.toThrow(/refuses non-local host/);
  });

  it('drops the database and re-creates the users', async () => {
    await db().db.collection<{ _id: string }>('items').insertOne({ _id: 'stale' });
    await resetLocalDatabase(testMongoUri(), db().name, [
      { user: 'mc_admin', login, password: 'third-password-123456' },
    ]);
    expect(await db().db.collection('items').countDocuments()).toBe(0);
    expect(await canLogIn('third-password-123456')).toBe(true);
  });
});
