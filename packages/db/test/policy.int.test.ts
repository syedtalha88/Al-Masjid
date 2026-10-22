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
    actor_id:
      scope.kind === 'admin' || scope.kind === 'super'
        ? scope.adminId
        : scope.kind === 'device'
          ? scope.deviceId
          : new UUID(),
    actor_type: scope.kind === 'super' ? 'super_admin' : scope.kind,
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
  let skipped = 0;
  for (const { name, scope, column } of SCOPES) {
    it(`${name}: every namespace × operation`, async () => {
      const wrong: string[] = [];
      for (const namespace of NAMESPACES) {
        for (const operation of OPERATIONS) {
          const isView = namespace.startsWith('v_');
          const expected =
            scope.kind === 'system'
              ? !(isView && operation !== 'find') && namespace !== '_migrations'
              : column !== undefined && (SPEC[namespace]?.[column] ?? '').includes(LETTER[operation]);
          if (scope.kind === 'system' && (namespace === '_migrations' || (isView && operation !== 'find'))) {
            // The system scope has every policy cell; MongoDB itself refuses view writes and mc_system has no
            // _migrations privileges (02 §4.3) — skip what the database layer, not the policy, decides.
            skipped += 1;
            continue;
          }
          tested += 1;
          const got = await attempt(namespace, scope, operation);
          if ((got === 'allowed') !== expected) wrong.push(`${namespace}.${operation}: ${got}`);
        }
      }
      expect(wrong).toEqual([]);
    });
  }
  it('the generated checklist covered 41 namespaces × 6 scopes × 4 operations (minus what MongoDB decides)', () => {
    expect(NAMESPACES).toHaveLength(41);
    // System scope: _migrations × 4 and 11 views × 3 write operations are left to MongoDB / the DB users.
    expect(skipped).toBe(4 + 11 * 3);
    expect(tested).toBe(41 * 6 * 4 - skipped); // only cells really attempted are counted (phase-verifier nit)
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

  it('an admin of another masjid reads none of C’s admins, stats, ameen counters, follow audience or push subscriptions', async () => {
    const duaOfC = new UUID();
    await raw('admin_users').insertOne({ _id: ownerOfC.adminId, display_name: 'Test Owner C' });
    await raw('masjid_admins').insertOne({ _id: new UUID(), masjid_id: masjidC, admin_id: ownerOfC.adminId });
    await raw('masjid_stats').insertOne({ _id: masjidC, followers: 3 });
    await raw('items').insertOne({ _id: duaOfC, masjid_id: masjidC, type: 'dua_request', title: 'Test dua' });
    await raw('ameen_counters').insertOne({ _id: duaOfC, count: 2 });
    await raw('device_follows').insertOne({ _id: new UUID(), device_id: new UUID(), masjid_id: masjidC, muted: false });
    await raw('admin_push_subscriptions').insertOne({ _id: new UUID(), admin_id: ownerOfC.adminId });
    const asD = (namespace: Namespace) => scoped({ scope: adminOfD, db: db() }, namespace);
    const asC = (namespace: Namespace) => scoped({ scope: ownerOfC, db: db() }, namespace);
    const probes: [Namespace, Record<string, unknown>][] = [
      ['admin_users', { _id: ownerOfC.adminId }],
      ['masjid_stats', { _id: masjidC }],
      ['ameen_counters', { _id: duaOfC }],
      ['v_admin_follow_audience', { masjid_id: masjidC }],
      ['admin_push_subscriptions', { admin_id: ownerOfC.adminId }],
    ];
    for (const [namespace, filter] of probes) {
      expect(await asD(namespace).count(filter), `${namespace} leaks to admin of D`).toBe(0);
      expect(await asD(namespace).count({}), `${namespace} leaks to admin of D (no filter)`).toBe(0);
      expect(await asC(namespace).count(filter), `${namespace} visible to its owner`).toBe(1);
    }
    expect(await asD('admin_push_subscriptions').deleteOne({ admin_id: ownerOfC.adminId })).toBe(0);
  });

  it('an admin of another masjid writes nothing of C: timings, chanda, campaign history, audit entries, masjid', async () => {
    const asD = (namespace: Namespace) => scoped({ scope: adminOfD, db: db(), contentMasjidId: masjidC }, namespace);
    for (const namespace of ['special_timings', 'chanda_weeks', 'campaign_amount_history'] as const) {
      await expect(
        asD(namespace).insertOne({ _id: new UUID(), masjid_id: masjidC, type: 'x' }),
        namespace,
      ).rejects.toBeInstanceOf(PolicyDeniedError);
    }
    for (const namespace of ['special_timings', 'chanda_weeks'] as const) {
      expect(await asD(namespace).updateMany({}, { $set: { note: 'pwned' } }), namespace).toBe(0);
    }
    expect(await asD('special_timings').deleteOne({ masjid_id: masjidC })).toBe(0);
    expect(await asD('masjids').updateOne({ _id: masjidC }, { $set: { show_chanda: true } })).toBe(0);
    // Audit entries: the admin as actor and one of their masjids or none — never planted in C's audit view.
    const audit = scoped({ scope: adminOfD, db: db() }, 'audit_log');
    const entry = (extra: Record<string, unknown>) => ({
      _id: new UUID(),
      at: new Date(),
      action: 'auth.logout',
      actor_type: 'admin',
      ...extra,
    });
    await expect(audit.insertOne(entry({ actor_id: adminOfD.adminId, masjid_id: masjidC }))).rejects.toBeInstanceOf(
      PolicyDeniedError,
    );
    await expect(audit.insertOne(entry({ actor_id: ownerOfC.adminId }))).rejects.toBeInstanceOf(PolicyDeniedError);
    // … nor stamped as someone more privileged (phase-verifier N1).
    for (const actor_type of ['super_admin', 'system', 'device']) {
      await expect(audit.insertOne(entry({ actor_id: adminOfD.adminId, actor_type }))).rejects.toBeInstanceOf(
        PolicyDeniedError,
      );
    }
    await audit.insertOne(entry({ actor_id: adminOfD.adminId }));
    await audit.insertOne(entry({ actor_id: adminOfD.adminId, masjid_id: adminOfD.masjids[0]?.id }));
    for (const namespace of ['special_timings', 'chanda_weeks', 'masjids'] as const) {
      expect(await raw(namespace).countDocuments({ $or: [{ note: 'pwned' }, { show_chanda: true }] }), namespace).toBe(
        0,
      );
    }
  });

  it('an admin of another masjid writes none of C’s timings, other admins’ records or push subscriptions', async () => {
    const timings = scoped({ scope: adminOfD, db: db(), contentMasjidId: masjidC }, 'masjid_timings');
    await expect(timings.insertOne({ _id: masjidC, rev: 2 })).rejects.toBeInstanceOf(PolicyDeniedError);
    expect(await timings.updateOne({ _id: masjidC }, { $set: { rev: 99 } })).toBe(0);
    expect(await timings.updateMany({}, { $set: { rev: 99 } })).toBe(0);
    expect(await raw('masjid_timings').findOne({ _id: masjidC })).toMatchObject({ rev: 1 });
    const otherAdmin = new UUID();
    await raw('admin_users').insertOne({ _id: otherAdmin, display_name: 'Test Other Admin' });
    const admins = scoped({ scope: adminOfD, db: db() }, 'admin_users');
    expect(await admins.updateOne({ _id: otherAdmin }, { $set: { display_name: 'pwned' } })).toBe(0);
    expect(await raw('admin_users').findOne({ _id: otherAdmin })).toMatchObject({ display_name: 'Test Other Admin' });
    const subscriptions = scoped({ scope: adminOfD, db: db() }, 'admin_push_subscriptions');
    await expect(subscriptions.insertOne({ _id: new UUID(), admin_id: otherAdmin })).rejects.toBeInstanceOf(
      PolicyDeniedError,
    );
  });

  it('a device writes audit entries only as itself (phase-verifier N1)', async () => {
    const mine = deviceScope(new UUID());
    const audit = scoped({ scope: mine, db: db() }, 'audit_log');
    const entry = (extra: Record<string, unknown>) => ({
      _id: new UUID(),
      at: new Date(),
      action: 'device.follow',
      masjid_id: masjidC,
      ...extra,
    });
    for (const forged of [
      { actor_type: 'admin', actor_id: ownerOfC.adminId },
      { actor_type: 'super_admin', actor_id: new UUID() },
      { actor_type: 'system' },
      { actor_type: 'device', actor_id: new UUID() }, // another device
    ]) {
      await expect(audit.insertOne(entry(forged)), JSON.stringify(forged.actor_type)).rejects.toBeInstanceOf(
        PolicyDeniedError,
      );
    }
    await audit.insertOne(entry({ actor_type: 'device', actor_id: mine.deviceId }));
  });

  it('a device changes nothing of another device: its record, follows or ameens', async () => {
    const mine = deviceScope(new UUID());
    const theirs = deviceScope(new UUID());
    const theirFollow = new UUID();
    const theirAmeen = new UUID();
    await raw('devices').insertOne({ _id: theirs.deviceId, locale: 'en' });
    await raw('device_follows').insertOne({ _id: theirFollow, device_id: theirs.deviceId, masjid_id: masjidC });
    await raw('ameens').insertOne({ _id: theirAmeen, device_id: theirs.deviceId, item_id: new UUID() });
    const as = (namespace: Namespace) => scoped({ scope: mine, db: db() }, namespace);
    expect(await as('devices').updateOne({ _id: theirs.deviceId }, { $set: { locale: 'ur' } })).toBe(0);
    expect(await as('devices').deleteOne({ _id: theirs.deviceId })).toBe(0);
    expect(await as('device_follows').updateOne({ _id: theirFollow }, { $set: { muted: true } })).toBe(0);
    expect(await as('device_follows').deleteOne({ _id: theirFollow })).toBe(0);
    await expect(
      as('device_follows').insertOne({ _id: new UUID(), device_id: theirs.deviceId, masjid_id: masjidC }),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
    expect(await as('ameens').deleteOne({ _id: theirAmeen })).toBe(0);
    await expect(
      as('ameens').insertOne({ _id: new UUID(), device_id: theirs.deviceId, item_id: new UUID() }),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
    expect(await raw('devices').findOne({ _id: theirs.deviceId })).toMatchObject({ locale: 'en' });
    expect(await raw('device_follows').countDocuments({ _id: theirFollow, muted: { $exists: false } })).toBe(1);
    expect(await raw('ameens').countDocuments({ _id: theirAmeen })).toBe(1);
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

  it('no generic write un-removes an item, removes one, or touches the purge marker (04 §5, review M2)', async () => {
    const removedId = new UUID();
    const liveId = new UUID();
    await raw('items').insertMany([
      { _id: removedId, masjid_id: masjidA, status: 'removed', purge_after: new Date('2027-04-01T00:00:00Z') },
      { _id: liveId, masjid_id: masjidA, status: 'published', title: 'Test notice' },
    ]);
    const asAdmin = scoped({ scope: adminOfA, db: db(), contentMasjidId: masjidA }, 'items');
    const asSuper = scoped({ scope: superScope(new UUID()), db: db(), contentMasjidId: masjidA }, 'items');
    for (const items of [asAdmin, asSuper]) {
      // A removed item is outside every generic update: un-removing matches nothing.
      expect(await items.updateOne({ _id: removedId }, { $set: { status: 'published' } })).toBe(0);
      for (const update of [
        { $set: { status: 'removed' } },
        { $set: { purge_after: new Date() } },
        { $unset: { purge_after: '' } },
        { $set: { removed_reason: 'x' } },
        { $set: { status: 'removed' }, $setOnInsert: { status: 'draft' } }, // a later entry hides nothing (L-10)
      ]) {
        await expect(items.updateOne({ _id: liveId }, update), JSON.stringify(update)).rejects.toBeInstanceOf(
          PolicyDeniedError,
        );
      }
      for (const extra of [{ status: 'removed' }, { status: 'draft', purge_after: new Date() }]) {
        await expect(
          items.insertOne({ _id: new UUID(), masjid_id: masjidA, title: 'Test', ...extra }),
        ).rejects.toBeInstanceOf(PolicyDeniedError);
      }
    }
    expect(await raw('items').findOne({ _id: removedId })).toMatchObject({ status: 'removed' });
    // An upsert may insert: equality fields of its filter seed the new document, so it must pass the insert rules
    // (review M-B) — no removed / purge-marked item, nothing outside the tenant.
    for (const filter of [
      { _id: new UUID(), masjid_id: masjidA, status: 'removed' },
      { _id: new UUID(), masjid_id: masjidA, purge_after: new Date() },
      { _id: new UUID(), masjid_id: masjidA, $and: [{ status: { $eq: 'removed' } }] },
      { _id: new UUID(), masjid_id: new UUID() }, // another masjid
    ]) {
      await expect(
        asAdmin.updateOne(filter, { $set: { title: 'Test' } }, { upsert: true }),
        JSON.stringify(Object.keys(filter)),
      ).rejects.toBeInstanceOf(PolicyDeniedError);
    }
    // A legitimate upsert (Super scope; an admin's own-masjid fence + contentWrite() masjid seed masjid_id twice, which
    // MongoDB itself refuses — admin repositories insert instead).
    const upserted = new UUID();
    expect(
      await asSuper.updateOne(
        { _id: upserted }, // masjid_id comes from the contentWrite() fence
        { $set: { title: 'Test upsert', status: 'draft' } },
        { upsert: true },
      ),
    ).toBe(1);
    expect(await raw('items').findOne({ _id: upserted })).toMatchObject({ status: 'draft', masjid_id: masjidA });
    expect(await asAdmin.updateOne({ _id: liveId }, { $set: { status: 'deleted', deleted_at: new Date() } })).toBe(1);
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
