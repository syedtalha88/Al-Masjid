// DB-privilege tests (02 §4.3, 10 §1, PHASE_01 T1.1): connect AS each database user and prove MongoDB itself allows
// exactly the 02 §4.3 cells — every CRUD action on every collection, find on every view — and refuses the rest with
// `Unauthorized`. Users get per-file login names so parallel test files never collide; all are dropped afterwards.
import { randomBytes } from 'node:crypto';

import { type Db, MongoClient, MongoServerError } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { COLLECTIONS, VIEW_SOURCES, type ViewName } from '../src/collections.ts';
import { CRUD, type CrudAction, DB_USERS, type DbUser, isAllowed } from '../src/roles.ts';
import { applyLocalRoles, dropLocalRoles } from '../src/roles-local.ts';
import { createTestDatabase, type TestDatabase, testMongoUri } from '../src/testing/index.ts';

const UNAUTHORIZED = 13;
const suffix = randomBytes(3).toString('hex');
const login = (user: DbUser) => `${user}_t${suffix}`;
const passwords = Object.fromEntries(DB_USERS.map((u) => [u, randomBytes(24).toString('base64url')])) as Record<
  DbUser,
  string
>;

let root: TestDatabase | undefined;
const clients = new Map<DbUser, MongoClient>();
const rootDb = (): TestDatabase => {
  if (!root) throw new Error('test database not created');
  return root;
};
const dbAs = (user: DbUser): Db => {
  const client = clients.get(user);
  if (!client) throw new Error(`no client for ${user}`);
  return client.db(rootDb().name);
};

/** Runs one CRUD action as `user`; resolves to 'ok' or the server error code. */
async function attempt(user: DbUser, namespace: string, action: CrudAction): Promise<'ok' | number> {
  const collection = dbAs(user).collection<{ _id: string; probe?: number }>(namespace);
  const id = `probe-${user}`;
  try {
    if (action === 'find') await collection.findOne({ _id: id });
    if (action === 'insert') await collection.insertOne({ _id: `${id}-${randomBytes(4).toString('hex')}` });
    if (action === 'update') await collection.updateOne({ _id: id }, { $set: { probe: 1 } });
    if (action === 'remove') await collection.deleteOne({ _id: id });
    return 'ok';
  } catch (error) {
    if (error instanceof MongoServerError && typeof error.code === 'number') return error.code;
    throw error;
  }
}

beforeAll(async () => {
  root = await createTestDatabase('privileges');
  for (const name of COLLECTIONS) await rootDb().db.createCollection(name);
  for (const [view, source] of Object.entries(VIEW_SOURCES)) {
    await rootDb().db.createCollection(view, { viewOn: source, pipeline: [{ $match: {} }] });
  }
  await applyLocalRoles(
    root.client,
    root.name,
    DB_USERS.map((user) => ({ user, login: login(user), password: passwords[user] })),
  );
  for (const user of DB_USERS) {
    const url = new URL(testMongoUri());
    url.username = login(user);
    url.password = passwords[user];
    const client = new MongoClient(url.toString(), { serverSelectionTimeoutMS: 5000, appName: `mc-test-${user}` });
    await client.connect();
    clients.set(user, client);
  }
});

afterAll(async () => {
  for (const client of clients.values()) await client.close();
  if (root) {
    await dropLocalRoles(rootDb().client, rootDb().name, DB_USERS.map(login));
    await root.dispose();
  }
});

describe('MongoDB enforces 02 §4.3 for every user × collection × CRUD action', () => {
  for (const user of DB_USERS) {
    it(user, async () => {
      const wrong: string[] = [];
      for (const namespace of COLLECTIONS) {
        for (const action of CRUD) {
          const result = await attempt(user, namespace, action);
          const allowed = isAllowed(user, namespace, action);
          if (allowed && result !== 'ok') wrong.push(`${namespace}.${action}: expected ok, got ${String(result)}`);
          if (!allowed && result !== UNAUTHORIZED)
            wrong.push(`${namespace}.${action}: expected Unauthorized, got ${String(result)}`);
        }
      }
      expect(wrong).toEqual([]);
    });
  }
});

describe('views (02 §4.2): find only where granted', () => {
  for (const user of DB_USERS) {
    it(user, async () => {
      const wrong: string[] = [];
      for (const view of Object.keys(VIEW_SOURCES) as ViewName[]) {
        const result = await attempt(user, view, 'find');
        const allowed = isAllowed(user, view, 'find');
        if (allowed !== (result === 'ok')) wrong.push(`${view}.find: ${String(result)}`);
      }
      expect(wrong).toEqual([]);
    });
  }
});

describe('T1.1 capability checks (also run against Atlas by db:verify-roles)', () => {
  it('(2) mc_public reads a view without any privilege on its source collection', async () => {
    await rootDb()
      .db.collection<{ _id: string; name: string }>('masjids')
      .insertOne({ _id: 'm1', name: 'Test Masjid Alpha' });
    expect(await attempt('mc_public', 'masjids', 'find')).toBe(UNAUTHORIZED);
    const viaView = await dbAs('mc_public')
      .collection<{ _id: string; name: string }>('v_pub_masjids')
      .find({})
      .toArray();
    expect(viaView.map((doc) => doc.name)).toContain('Test Masjid Alpha');
  });

  it('(3) multi-document transactions commit as an application user', async () => {
    const client = clients.get('mc_public');
    if (!client) throw new Error('no client');
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        const db = client.db(rootDb().name);
        await db.collection<{ _id: string }>('devices').insertOne({ _id: 'tx-device' }, { session });
        await db.collection<{ _id: string }>('device_follows').insertOne({ _id: 'tx-follow' }, { session });
      });
    } finally {
      await session.endSession();
    }
    expect(await rootDb().db.collection<{ _id: string }>('device_follows').countDocuments({ _id: 'tx-follow' })).toBe(
      1,
    );
  });

  it('writes to a view are refused even for the system user', async () => {
    const result = await attempt('mc_system', 'v_pub_items', 'insert');
    expect(result).not.toBe('ok');
  });

  it('mc_migrator creates indexes but cannot read application data', async () => {
    const items = dbAs('mc_migrator').collection('items');
    await expect(items.createIndex({ masjid_id: 1 })).resolves.toBe('masjid_id_1');
    expect(await attempt('mc_migrator', 'items', 'find')).toBe(UNAUTHORIZED);
    expect(await attempt('mc_admin', 'items', 'find')).toBe('ok');
    await expect(dbAs('mc_admin').collection('items').createIndex({ x: 1 })).rejects.toMatchObject({
      code: UNAUTHORIZED,
    });
  });
});
