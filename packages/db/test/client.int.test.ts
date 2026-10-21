// PHASE_01 T1.5 against a real MongoDB: lazy single client, ping/close, transactions (commit, abort, retry on a
// transient error commits exactly once), scopes never leak between concurrent operations.
import { MongoServerError, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbHandle, type DbHandle, withTransaction } from '../src/client.ts';
import { adminScope, deviceScope } from '../src/scope.ts';
import { scoped } from '../src/scoped.ts';
import { createTestDatabase, type TestDatabase, testMongoUri } from '../src/testing/index.ts';

let test: TestDatabase | undefined;
let handle: DbHandle | undefined;
const h = (): DbHandle => {
  if (!handle) throw new Error('no handle');
  return handle;
};
const notes = () => {
  if (!test) throw new Error('no test database');
  return test.db.collection<{ _id: string; n?: number }>('notes');
};

beforeAll(async () => {
  test = await createTestDatabase('client');
  await test.db.createCollection('notes');
  handle = createDbHandle({ uri: testMongoUri(), database: test.name, process: 'script', local: true });
});

afterAll(async () => {
  await handle?.close();
  await test?.dispose();
});

describe('DbHandle', () => {
  it('connects lazily once; concurrent callers share the connection', async () => {
    const [a, b] = await Promise.all([h().db(), h().db()]);
    expect(a).toBe(b);
    expect(a.databaseName).toBe(test?.name);
  });

  it('ping reports ok with a latency; an unreachable server reports not ok without throwing', async () => {
    await expect(h().ping()).resolves.toMatchObject({ ok: true });
    const dead = createDbHandle({
      uri: 'mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=300',
      database: 'x',
      process: 'script',
      local: true,
    });
    await expect(dead.ping()).resolves.toMatchObject({ ok: false });
    await dead.close();
  });

  it('a closed handle refuses further use', async () => {
    const other = createDbHandle({ uri: testMongoUri(), database: 'x', process: 'script', local: true });
    await other.close();
    await expect(other.db()).rejects.toThrow(/closed/);
  });
});

describe('withTransaction', () => {
  const scope = deviceScope(new UUID());

  it('commits all writes together and returns the callback value', async () => {
    const result = await withTransaction(h(), scope, async ({ db, session }) => {
      await db.collection<{ _id: string }>('notes').insertOne({ _id: 'tx-a' }, { session });
      await db.collection<{ _id: string }>('notes').insertOne({ _id: 'tx-b' }, { session });
      return 'done';
    });
    expect(result).toBe('done');
    expect(await notes().countDocuments({ _id: { $in: ['tx-a', 'tx-b'] } })).toBe(2);
  });

  it('an error aborts: nothing is written', async () => {
    await expect(
      withTransaction(h(), scope, async ({ db, session }) => {
        await db.collection<{ _id: string }>('notes').insertOne({ _id: 'tx-abort' }, { session });
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    expect(await notes().countDocuments({ _id: 'tx-abort' })).toBe(0);
  });

  it('a transient transaction error is retried and commits exactly once', async () => {
    let attempts = 0;
    await withTransaction(h(), scope, async ({ db, session }) => {
      attempts += 1;
      await db
        .collection<{ _id: string; n?: number }>('notes')
        .updateOne({ _id: 'counter' }, { $inc: { n: 1 } }, { upsert: true, session });
      if (attempts === 1) {
        const error = new MongoServerError({ message: 'simulated write conflict', code: 112 });
        error.addErrorLabel('TransientTransactionError');
        throw error;
      }
    });
    expect(attempts).toBe(2);
    expect((await notes().findOne({ _id: 'counter' }))?.n).toBe(1);
  });

  it('scopes never leak between concurrent operations: 50 interleaved admins each read only their own masjid', async () => {
    if (!test) throw new Error('no test database');
    await test.db.createCollection('items');
    const masjids = Array.from({ length: 5 }, () => new UUID());
    await test.db
      .collection<{ _id: UUID; masjid_id: UUID }>('items')
      .insertMany(masjids.flatMap((masjid_id) => [0, 1].map(() => ({ _id: new UUID(), masjid_id }))));
    const runs = Array.from({ length: 50 }, (_, i) => {
      const masjid = masjids[i % masjids.length] ?? masjids[0];
      if (!masjid) throw new Error('no masjid');
      return { masjid, scope: adminScope({ adminId: new UUID(), masjids: [{ id: masjid, role: 'owner' }] }) };
    });
    const seen = await Promise.all(
      runs.map(({ scope }) =>
        withTransaction(h(), scope, async (ctx) => {
          // Interleave: half the reads wait so other transactions run in between.
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
          const items = scoped({ scope: ctx.scope, db: ctx.db, session: ctx.session }, 'items');
          return (await items.find({})).map((row) => (row['masjid_id'] as UUID).toHexString());
        }),
      ),
    );
    seen.forEach((owners, i) => {
      expect(owners).toHaveLength(2);
      expect(new Set(owners)).toEqual(new Set([runs[i]?.masjid.toHexString()]));
    });
  });
});
