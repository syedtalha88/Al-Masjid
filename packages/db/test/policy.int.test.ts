// PHASE_01 T1.4 acceptance: every (namespace × scope × operation) cell of 02 §4.1 — 41 × 6 × 4 = 984 — is exercised
// through `scoped()` against a real MongoDB and compared with an independent transcription of the table; plus
// cross-masjid isolation (crafted ids, injected filters), an admin without memberships, allow-listed fields, hidden
// fields, redaction, forged scopes and the operator-key guard.
import { type Db, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { COLLECTIONS, CONTENT_COLLECTIONS, type Namespace, NAMESPACES, VIEW_SOURCES } from '../src/collections.ts';
import { type Operation, PolicyDeniedError } from '../src/policy.ts';
import { adminScope, deviceScope, hookScope, publicScope, type Scope, superScope, systemScope } from '../src/scope.ts';
import { scoped } from '../src/scoped.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing/index.ts';

// 02 §4.1 — S/I/U/D per scope column. Transcribed from the document, NOT from src/policy.ts.
type Column = 'public' | 'device' | 'admin' | 'super';
const SPEC: Readonly<Partial<Record<Namespace, Partial<Record<Column, string>>>>> = {
  masjids: { admin: 'SU', super: 'SIU' },
  masjid_stats: { device: 'U', admin: 'S', super: 'S' },
  admin_users: { admin: 'SU', super: 'SIU' },
  masjid_admins: { admin: 'S', super: 'SID' },
  webauthn_credentials: { super: 'S' },
  admin_invites: { super: 'S' },
  admin_sessions: { super: 'S' },
  masjid_timings: { admin: 'SIUD', super: 'SIUD' },
  special_timings: { admin: 'SIUD', super: 'SIUD' },
  items: { admin: 'SIU', super: 'SIUD' },
  ameens: { device: 'ID' },
  ameen_counters: { public: 'S', device: 'SIU', admin: 'S', super: 'S' },
  campaign_amount_history: { admin: 'SI', super: 'S' },
  chanda_weeks: { admin: 'SIU', super: 'SIUD' },
  content_library: { admin: 'S', super: 'SIUD' },
  notice_templates: { admin: 'S', super: 'SIUD' },
  payment_profiles: { admin: 'S', super: 'S' },
  devices: { public: 'I', device: 'SUD' },
  device_follows: { device: 'SIUD' },
  admin_push_subscriptions: { admin: 'SID', super: 'SID' },
  notification_jobs: { admin: 'S', super: 'S' },
  push_quota_usage: { admin: 'S', super: 'S' },
  reports: { device: 'I', admin: 'S', super: 'SU' },
  grievances: { public: 'I', super: 'SU' },
  grievance_seq: { public: 'SIU', super: 'SU' },
  legal_orders: { super: 'SIU' },
  audit_log: { device: 'I', admin: 'SI', super: 'SI' },
  app_settings: { admin: 'S', super: 'SU' },
  stats_snapshots: { super: 'S' },
  _migrations: {},
  v_pub_masjids: { public: 'S', device: 'S', admin: 'S', super: 'S' },
  v_pub_masjid_status: { public: 'S', device: 'S', admin: 'S', super: 'S' },
  v_pub_timings: { public: 'S', device: 'S', admin: 'S', super: 'S' },
  v_pub_special_timings: { public: 'S', device: 'S', admin: 'S', super: 'S' },
  v_pub_items: { public: 'S', device: 'S', admin: 'S', super: 'S' },
  v_pub_chanda_weeks: { public: 'S', device: 'S', admin: 'S', super: 'S' },
  v_pub_payment_profiles: { public: 'S', device: 'S', admin: 'S', super: 'S' },
  v_pub_library: { public: 'S', device: 'S', admin: 'S', super: 'S' },
  v_pub_templates: { public: 'S', device: 'S', admin: 'S', super: 'S' },
  v_pub_settings: { public: 'S', device: 'S', admin: 'S', super: 'S' },
  v_admin_follow_audience: { admin: 'S', super: 'S' },
};
const LETTER: Record<Operation, string> = { find: 'S', insert: 'I', update: 'U', delete: 'D' };
const OPERATIONS: readonly Operation[] = ['find', 'insert', 'update', 'delete'];

let test: TestDatabase | undefined;
const db = (): Db => {
  if (!test) throw new Error('no test database');
  return test.db;
};

const masjidA = new UUID();
const adminOfA = adminScope({ adminId: new UUID(), masjids: [{ id: masjidA, role: 'owner' }] });
/** Raw (unscoped) collection for test setup — UUID ids (the driver's default types assume ObjectId). */
const raw = (name: string) => db().collection<{ _id: UUID } & Record<string, unknown>>(name);
const device = deviceScope(new UUID());
const SCOPES: readonly { name: string; scope: Scope; column?: Column }[] = [
  { name: 'public', scope: publicScope(), column: 'public' },
  { name: 'device', scope: device, column: 'device' },
  { name: 'admin', scope: adminOfA, column: 'admin' },
  { name: 'super', scope: superScope(new UUID()), column: 'super' },
  { name: 'hook', scope: hookScope('test') },
  { name: 'system', scope: systemScope() },
];

/** A document inside the scope's tenant (and its content masjid), so an allowed insert is not refused for that. */
function docFor(namespace: Namespace, scope: Scope, contentId: UUID): Record<string, unknown> {
  const tenantId = namespace === 'masjids' || namespace === 'masjid_timings' || namespace === 'masjid_stats';
  const masjid = scope.kind === 'admin' ? masjidA : contentId;
  return {
    _id: tenantId ? masjid : new UUID(),
    masjid_id: masjid,
    device_id: scope.kind === 'device' ? scope.deviceId : new UUID(),
    admin_id: scope.kind === 'admin' || scope.kind === 'super' ? scope.adminId : new UUID(),
    status: 'verified',
    system: false,
  };
}

async function attempt(namespace: Namespace, scope: Scope, operation: Operation): Promise<'allowed' | 'denied'> {
  // Content writes are measured inside a contentWrite() context (the enforcement itself has its own tests): an admin's
  // own masjid, otherwise a fresh masjid id per attempt so inserts keyed by the masjid id never collide.
  const contentId = scope.kind === 'admin' ? masjidA : new UUID();
  const content = (CONTENT_COLLECTIONS as readonly Namespace[]).includes(namespace)
    ? { contentMasjidId: contentId }
    : {};
  const repo = scoped({ scope, db: db(), ...content }, namespace);
  try {
    if (operation === 'find') await repo.findOne({});
    if (operation === 'insert') await repo.insertOne(docFor(namespace, scope, contentId));
    if (operation === 'update') await repo.updateOne({ _id: new UUID() }, { $set: { updated_at: new Date() } });
    if (operation === 'delete') await repo.deleteOne({ _id: new UUID() });
    return 'allowed';
  } catch (error) {
    if (error instanceof PolicyDeniedError) return 'denied';
    throw error;
  }
}

beforeAll(async () => {
  test = await createTestDatabase('policy');
  for (const name of COLLECTIONS) await db().createCollection(name);
  for (const [view, source] of Object.entries(VIEW_SOURCES)) {
    await db().createCollection(view, { viewOn: source, pipeline: [{ $match: {} }] });
  }
});

afterAll(async () => {
  await test?.dispose();
});

describe('policy matrix (02 §4.1): every cell, allowed and denied', () => {
  let tested = 0;
  for (const { name, scope, column } of SCOPES) {
    it(`${name}: every namespace × operation`, async () => {
      const wrong: string[] = [];
      for (const namespace of NAMESPACES) {
        for (const operation of OPERATIONS) {
          tested += 1;
          const isView = namespace.startsWith('v_');
          const expected =
            scope.kind === 'system'
              ? !(isView && operation !== 'find') && namespace !== '_migrations'
              : column !== undefined && (SPEC[namespace]?.[column] ?? '').includes(LETTER[operation]);
          if (scope.kind === 'system' && (namespace === '_migrations' || (isView && operation !== 'find'))) {
            // The system scope has every policy cell; MongoDB itself refuses view writes and mc_system has no
            // _migrations privileges (02 §4.3) — skip what the database layer, not the policy, decides.
            continue;
          }
          const got = await attempt(namespace, scope, operation);
          if ((got === 'allowed') !== expected) wrong.push(`${namespace}.${operation}: ${got}`);
        }
      }
      expect(wrong).toEqual([]);
    });
  }
  it('the generated checklist covered 41 namespaces × 6 scopes × 4 operations', () => {
    expect(NAMESPACES).toHaveLength(41);
    expect(tested).toBe(41 * 6 * 4);
  });
});

describe('tenant isolation', () => {
  // Own masjids, so nothing the matrix test wrote for masjid C affects these counts.
  const masjidC = new UUID();
  const ownerOfC = adminScope({ adminId: new UUID(), masjids: [{ id: masjidC, role: 'owner' }] });
  const adminOfD = adminScope({ adminId: new UUID(), masjids: [{ id: new UUID(), role: 'owner' }] });
  const MASJID_SCOPED: readonly Namespace[] = [
    'special_timings',
    'items',
    'chanda_weeks',
    'campaign_amount_history',
    'payment_profiles',
    'notification_jobs',
    'push_quota_usage',
    'reports',
    'audit_log',
    'masjid_admins',
  ];

  beforeAll(async () => {
    for (const namespace of MASJID_SCOPED) {
      await raw(namespace).insertOne({ _id: new UUID(), masjid_id: masjidC, title: 'A only', type: 'x' });
    }
    await raw('masjids').insertOne({ _id: masjidC, name: 'Test Masjid Alpha', follow_code: 'CCCCCCCC' });
    await raw('masjid_timings').insertOne({ _id: masjidC, rev: 1 });
  });

  it('an admin of another masjid reads nothing of masjid C in any masjid-scoped collection, even by crafted id', async () => {
    const leaks: string[] = [];
    for (const namespace of [...MASJID_SCOPED, 'masjids', 'masjid_timings'] as Namespace[]) {
      const repo = scoped({ scope: adminOfD, db: db() }, namespace);
      try {
        const rows = await repo.find({ $or: [{ masjid_id: masjidC }, { _id: masjidC }, {}] });
        if (rows.length > 0) leaks.push(namespace);
      } catch (error) {
        if (!(error instanceof PolicyDeniedError)) throw error;
      }
    }
    expect(leaks).toEqual([]);
    // the owner does see them
    expect(await scoped({ scope: ownerOfC, db: db() }, 'items').count({})).toBe(1);
  });

  it('an admin of another masjid cannot insert into, update or delete masjid C', async () => {
    // Even inside a content context that claims masjid C, the tenant filter keeps it out.
    const items = scoped({ scope: adminOfD, db: db(), contentMasjidId: masjidC }, 'items');
    await expect(items.insertOne({ _id: new UUID(), masjid_id: masjidC })).rejects.toBeInstanceOf(PolicyDeniedError);
    expect(await items.updateOne({ masjid_id: masjidC }, { $set: { title: 'pwned' } })).toBe(0);
    expect(await items.updateMany({}, { $set: { title: 'pwned' } })).toBe(0);
    const timings = scoped({ scope: adminOfD, db: db(), contentMasjidId: masjidC }, 'masjid_timings');
    expect(await timings.deleteOne({ _id: masjidC })).toBe(0);
    expect(await db().collection('items').countDocuments({ title: 'pwned' })).toBe(0);
  });

  it('an admin without memberships (e.g. all removed) sees no masjid data', async () => {
    const nobody = adminScope({ adminId: new UUID(), masjids: [] });
    expect(await scoped({ scope: nobody, db: db() }, 'items').count({})).toBe(0);
    expect(await scoped({ scope: nobody, db: db() }, 'masjids').count({})).toBe(0);
  });

  it('a device sees only its own follows and device record', async () => {
    const mine = deviceScope(new UUID());
    const other = deviceScope(new UUID());
    await raw('device_follows').insertOne({ _id: new UUID(), device_id: mine.deviceId, masjid_id: masjidC });
    expect(await scoped({ scope: mine, db: db() }, 'device_follows').count({})).toBe(1);
    expect(await scoped({ scope: other, db: db() }, 'device_follows').count({ device_id: mine.deviceId })).toBe(0);
  });
});

describe('fields', () => {
  beforeAll(async () => {
    await raw('masjids').replaceOne(
      { _id: masjidA },
      { name: 'Test Masjid Alpha', show_chanda: false },
      { upsert: true },
    );
  });

  it('admin updates of non-allow-listed masjid fields are rejected', async () => {
    const masjids = scoped({ scope: adminOfA, db: db(), contentMasjidId: masjidA }, 'masjids');
    for (const field of ['status', 'follow_code', 'content_version', 'push_daily_quota', 'admin_count', 'name']) {
      await expect(masjids.updateOne({ _id: masjidA }, { $set: { [field]: 1 } })).rejects.toBeInstanceOf(
        PolicyDeniedError,
      );
    }
    await expect(masjids.updateOne({ _id: masjidA }, { $inc: { content_version: 1 } })).rejects.toBeInstanceOf(
      PolicyDeniedError,
    );
    expect(await masjids.updateOne({ _id: masjidA }, { $set: { show_chanda: true } })).toBe(1);
    // Outside contentWrite() even an allow-listed field is refused: it would skip the version bump (02 §5).
    const outside = scoped({ scope: adminOfA, db: db() }, 'masjids');
    await expect(outside.updateOne({ _id: masjidA }, { $set: { show_chanda: true } })).rejects.toBeInstanceOf(
      PolicyDeniedError,
    );
  });

  it('only the listed update operators are allowed', async () => {
    const masjids = scoped({ scope: superScope(new UUID()), db: db() }, 'masjids');
    await expect(masjids.updateOne({ _id: masjidA }, { $rename: { name: 'x' } })).rejects.toBeInstanceOf(
      PolicyDeniedError,
    );
  });

  it('hidden fields never come back (phone for the Super Admin list, device ids in admin reports)', async () => {
    await raw('admin_users').insertOne({
      _id: new UUID(),
      display_name: 'Test Admin',
      phone_enc: 'v1:k:secret',
      role: 'masjid_admin',
    });
    const admins = await scoped({ scope: superScope(new UUID()), db: db() }, 'admin_users').find({});
    expect(admins.some((doc) => 'phone_enc' in doc)).toBe(false);
    await raw('reports').insertOne({ _id: new UUID(), masjid_id: masjidA, device_id: new UUID(), reason: 'other' });
    const reports = await scoped({ scope: adminOfA, db: db() }, 'reports').find({});
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.some((doc) => 'device_id' in doc)).toBe(false);
  });

  it('removed items show no content to their admin', async () => {
    await raw('items').insertOne({
      _id: new UUID(),
      masjid_id: masjidA,
      status: 'removed',
      title: 'gone',
      body: 'gone',
      image_key: 'k',
    });
    const removed = (await scoped({ scope: adminOfA, db: db() }, 'items').find({ status: 'removed' }))[0];
    expect(removed).toBeDefined();
    expect(removed).not.toHaveProperty('title');
    expect(removed).not.toHaveProperty('body');
    expect(removed).not.toHaveProperty('image_key');
  });
});

describe('guards', () => {
  it('a forged scope object is refused for every operation', async () => {
    const forged = Object.freeze({ kind: 'system' }) as unknown as Scope;
    await expect(scoped({ scope: forged, db: db() }, 'items').findOne({})).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it('operator-shaped keys in written data are refused (NoSQL-injection guard)', async () => {
    const items = scoped({ scope: adminOfA, db: db() }, 'items');
    await expect(items.insertOne({ _id: new UUID(), masjid_id: masjidA, $where: 'sleep(1)' })).rejects.toBeInstanceOf(
      PolicyDeniedError,
    );
    await expect(
      items.insertOne({ _id: new UUID(), masjid_id: masjidA, template_params: { 'a.b': 1 } }),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
    await expect(
      items.updateOne({ masjid_id: masjidA }, { $set: { template_params: { nested: [{ $gt: '' }] } } }),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });
});
