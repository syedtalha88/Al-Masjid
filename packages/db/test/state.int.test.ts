// PHASE_01 T1.3 against a migrated MongoDB (validators on): content writes only via contentWrite() with a version bump
// each; follow codes (forced collisions); masjid creation and status transitions (step-up, activation rule,
// visibility mirror, audit); admin limit 5, follow limit 20 and single-use invites under concurrent requests; audit
// vocabulary and meta limits; later-phase stubs.
import { randomBytes } from 'node:crypto';

import { Binary, Long, MongoServerError, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import { createDbHandle, type DbHandle, withTransaction } from '../src/client.ts';
import { CONTENT_COLLECTIONS, type Namespace } from '../src/collections.ts';
import { contentWrite, CROCKFORD, genFollowCode, NotImplementedError, StateError, writeAudit } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { PolicyDeniedError } from '../src/policy.ts';
import { PRAYER } from '../src/schema/enums.ts';
import { adminScope, deviceScope, publicScope, superScope, systemScope } from '../src/scope.ts';
import { scoped } from '../src/scoped.ts';
import {
  addAdminToMasjid,
  changeMasjidStatus,
  consumeInvite,
  createAdmin,
  createInvite,
  createMasjid,
  followMasjid,
  INVITE_TTL_MS,
  recordAmeen,
  removeAdminFromMasjid,
  unfollowMasjid,
} from '../src/state/index.ts';
import { createTestDatabase, type TestDatabase, testMongoUri } from '../src/testing/index.ts';
import { toInt64 } from '../src/values.ts';

let test: TestDatabase | undefined;
let handle: DbHandle | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const h = () => {
  if (!handle) throw new Error('no handle');
  return handle;
};
type Raw = { _id: UUID } & Record<string, unknown>;
const raw = (name: string) => t().db.collection<Raw>(name);
/** Unique-indexed fields a partial fixture still needs (02 §2 indexes are not sparse). */
const UNIQUE_FIELDS: Readonly<Record<string, string>> = { masjids: 'follow_code', items: 'public_id' };
/** Fixture insert that skips the validator (tests set up partial documents). */
const fixture = (name: string, doc: Raw) => {
  const field = UNIQUE_FIELDS[name];
  const unique = field ? { [field]: randomBytes(8).toString('hex') } : {};
  return raw(name).insertOne({ ...unique, ...doc }, { bypassDocumentValidation: true });
};

/** Validator-complete child documents (the visibility mirror updates them, and updates are validated). */
const validTimings = (masjidId: UUID) =>
  raw('masjid_timings').insertOne({
    _id: masjidId,
    prayers: Object.fromEntries(
      PRAYER.map((name) => [
        name,
        { adhan_mode: 'auto', adhan_adjust_min: 0, jamaat_mode: 'offset', jamaat_offset_min: 10 },
      ]),
    ),
    jumuah: [{ seq: 1, jamaat_time: '13:30' }],
    masjid_visible: false,
    rev: 0,
    updated_by: SUPER_ID,
    updated_at: new Date(),
  });
const validChandaWeek = (masjidId: UUID) =>
  raw('chanda_weeks').insertOne({
    _id: new UUID(),
    masjid_id: masjidId,
    week_start: '2026-10-16',
    amount_paise: toInt64(0),
    visible: true,
    masjid_visible: false,
    created_by: SUPER_ID,
    created_at: new Date(),
    updated_at: new Date(),
  });

const SUPER_ID = new UUID();
const superNow = () => superScope(SUPER_ID, new Date());
const MASJID_INPUT = {
  name: 'Test Masjid Alpha',
  area: 'Test Area',
  city: 'Hyderabad',
  state: 'Telangana',
  address: 'Test address',
  lat: 17.3850001234,
  lng: 78.4867,
};
const audits = (action: string) => t().db.collection('audit_log').countDocuments({ action });
const errorCode = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof StateError) return error.code;
    if (error instanceof PolicyDeniedError) return 'POLICY_DENIED';
    throw error;
  }
};

beforeAll(async () => {
  test = await createTestDatabase('state');
  await runMigrations(t().db, MIGRATIONS);
  handle = createDbHandle({ uri: testMongoUri(), database: t().name, process: 'script', local: true });
});

afterAll(async () => {
  await handle?.close();
  await test?.dispose();
});

describe('content writes (02 §5 version bump)', () => {
  it('every content collection: refused outside contentWrite(), bumps content_version once inside it', async () => {
    const { id } = await createMasjid(h(), superNow(), MASJID_INPUT);
    const admin = adminScope({ adminId: new UUID(), masjids: [{ id, role: 'owner' }] });
    const version = async () =>
      (await raw('masjids').findOne({ _id: id }, { promoteLongs: false }))?.['content_version'] as Long;
    for (const name of CONTENT_COLLECTIONS) {
      if (name === 'payment_profiles') {
        // No admin write cell at all: it changes only through the Phase 5 state functions (02 §3).
        await expect(
          withTransaction(h(), admin, (ctx) =>
            contentWrite(ctx, id, (content) => scoped(content, name).updateMany({}, { $set: { note: 'x' } })),
          ),
        ).rejects.toBeInstanceOf(PolicyDeniedError);
        continue;
      }
      const outside = scoped({ scope: admin, db: t().db }, name);
      await expect(outside.updateMany({}, { $set: { updated_at: new Date() } })).rejects.toBeInstanceOf(
        PolicyDeniedError,
      );
      const before = (await version()).toNumber();
      await withTransaction(h(), admin, (ctx) =>
        contentWrite(ctx, id, (content) =>
          scoped(content, name as Namespace).updateMany({}, { $set: { updated_at: new Date() } }),
        ),
      );
      const after = await version();
      expect(after.toNumber()).toBe(before + 1);
      expect(after).toBeInstanceOf(Long); // stays int64 (02 §0)
    }
  });

  it('contentWrite() for one masjid cannot touch another masjid of the same admin', async () => {
    const a = await createMasjid(h(), superNow(), MASJID_INPUT);
    const b = await createMasjid(h(), superNow(), MASJID_INPUT);
    await fixture('items', { _id: new UUID(), masjid_id: b.id, title: 'B item' });
    const admin = adminScope({
      adminId: new UUID(),
      masjids: [
        { id: a.id, role: 'owner' },
        { id: b.id, role: 'owner' },
      ],
    });
    const changed = await withTransaction(h(), admin, (ctx) =>
      contentWrite(ctx, a.id, (content) =>
        scoped(content, 'items').updateMany({ masjid_id: b.id }, { $set: { title: 'changed' } }),
      ),
    );
    expect(changed).toBe(0);
    expect((await raw('items').findOne({ masjid_id: b.id }))?.['title']).toBe('B item');
  });
});

describe('follow codes (02 §3)', () => {
  it('8 Crockford characters, never I, L, O or U', () => {
    for (let i = 0; i < 2000; i += 1) expect(genFollowCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(CROCKFORD).toHaveLength(32);
    expect(genFollowCode(() => Buffer.alloc(5, 0))).toBe('00000000');
    expect(genFollowCode(() => Buffer.alloc(5, 255))).toBe('ZZZZZZZZ');
  });

  it('a duplicate code is retried with a new one; five collisions in a row give up', async () => {
    const fixed = randomBytes(5);
    const first = await createMasjid(h(), superNow(), MASJID_INPUT, { random: () => fixed });
    let calls = 0;
    const second = await createMasjid(h(), superNow(), MASJID_INPUT, {
      random: (n) => (++calls <= 2 ? fixed : randomBytes(n)),
    });
    expect(calls).toBe(3);
    expect(second.followCode).not.toBe(first.followCode);
    expect(await errorCode(createMasjid(h(), superNow(), MASJID_INPUT, { random: () => fixed }))).toBe(
      'FOLLOW_CODE_EXHAUSTED',
    );
  });
});

describe('masjids', () => {
  it('createMasjid: pending masjid, audit — all or nothing; no stats document until the first follow', async () => {
    const { id, followCode } = await createMasjid(h(), superNow(), MASJID_INPUT);
    const masjid = await raw('masjids').findOne({ _id: id });
    expect(masjid).toMatchObject({ status: 'pending', follow_code: followCode, admin_count: 0, lat: 17.385 });
    expect(await raw('masjid_stats').findOne({ _id: id })).toBeNull(); // mc_admin may not insert it (02 §4.3)
    expect(
      await t().db.collection('audit_log').countDocuments({ action: 'masjid.create', target_id: id.toHexString() }),
    ).toBe(1);
    // A value 02 forbids (outside India) fails the validator and leaves nothing behind.
    const before = await audits('masjid.create');
    await expect(createMasjid(h(), superNow(), { ...MASJID_INPUT, lat: 51.5 })).rejects.toBeInstanceOf(
      MongoServerError,
    );
    expect(await audits('masjid.create')).toBe(before);
    expect(await errorCode(createMasjid(h(), adminScope({ adminId: new UUID(), masjids: [] }), MASJID_INPUT))).toBe(
      'FORBIDDEN',
    );
  });

  it('status transitions: activation rule, step-up for ★, visibility mirror, version bump, audit', async () => {
    const { id } = await createMasjid(h(), superNow(), MASJID_INPUT);
    await validTimings(id);
    await validChandaWeek(id);
    expect(await errorCode(changeMasjidStatus(h(), superNow(), { masjidId: id, transition: 'activate' }))).toBe(
      'ACTIVATION_REQUIREMENTS',
    );
    const adminId = await createAdmin(h(), superNow(), { displayName: 'Test Admin', uiLocale: 'en' });
    await addAdminToMasjid(h(), superNow(), { masjidId: id, adminId, role: 'owner' });
    expect(await errorCode(changeMasjidStatus(h(), superNow(), { masjidId: id, transition: 'activate' }))).toBe(
      'ACTIVATION_REQUIREMENTS', // invited, no undertaking yet
    );
    await raw('admin_users').updateOne(
      { _id: adminId },
      { $set: { status: 'active', undertaking_version: 'draft-1' } },
    );
    await changeMasjidStatus(h(), superNow(), { masjidId: id, transition: 'activate' });
    const activated = await raw('masjids').findOne({ _id: id });
    expect(activated).toMatchObject({ status: 'active' });
    expect(activated?.['verified_at']).toBeInstanceOf(Date);
    expect(await raw('chanda_weeks').findOne({ masjid_id: id })).toMatchObject({ masjid_visible: true });
    expect(await raw('masjid_timings').findOne({ _id: id })).toMatchObject({ masjid_visible: true });
    expect(await raw('v_pub_masjids').countDocuments({ _id: id })).toBe(1);

    // ★ suspend: no step-up, stale step-up, fresh step-up
    const stale = superScope(SUPER_ID, new Date(Date.now() - 6 * 60_000));
    expect(
      await errorCode(changeMasjidStatus(h(), superScope(SUPER_ID), { masjidId: id, transition: 'suspend' })),
    ).toBe('STEP_UP_REQUIRED');
    expect(await errorCode(changeMasjidStatus(h(), stale, { masjidId: id, transition: 'suspend' }))).toBe(
      'STEP_UP_REQUIRED',
    );
    await changeMasjidStatus(h(), superNow(), { masjidId: id, transition: 'suspend', reason: 'test reason' });
    expect(await raw('chanda_weeks').findOne({ masjid_id: id })).toMatchObject({ masjid_visible: false });
    expect(await raw('masjid_timings').findOne({ _id: id })).toMatchObject({ masjid_visible: false });
    expect(await errorCode(changeMasjidStatus(h(), superNow(), { masjidId: id, transition: 'activate' }))).toBe(
      'INVALID_TRANSITION',
    );
    await changeMasjidStatus(h(), superNow(), { masjidId: id, transition: 'unsuspend' });
    await changeMasjidStatus(h(), superNow(), { masjidId: id, transition: 'delete' });
    const deleted = await raw('masjids').findOne({ _id: id });
    expect(deleted).toMatchObject({ status: 'deleted' });
    expect(deleted?.['deleted_at']).toBeInstanceOf(Date);
    const masjid = await raw('masjids').findOne({ _id: id }, { promoteLongs: false });
    expect((masjid?.['content_version'] as Long).toNumber()).toBe(5); // created at 1, four transitions
    const entries = await raw('audit_log').find({ masjid_id: id }).sort({ _id: 1 }).toArray();
    expect(entries.map((e) => e['action'])).toEqual(
      expect.arrayContaining([
        'masjid.create',
        'masjid.activate',
        'masjid.suspend',
        'masjid.unsuspend',
        'masjid.delete',
      ]),
    );
    expect(entries.find((e) => e['action'] === 'masjid.suspend')).toMatchObject({
      actor_type: 'super_admin',
      meta: { reason: 'test reason' },
    });
    expect(await errorCode(changeMasjidStatus(h(), superNow(), { masjidId: new UUID(), transition: 'activate' }))).toBe(
      'MASJID_NOT_FOUND',
    );
  });
});

describe('admins (02 §5 admin limit)', () => {
  it('8 concurrent additions: exactly 5 succeed; duplicates refused; removal needs step-up and frees a slot', async () => {
    const { id } = await createMasjid(h(), superNow(), MASJID_INPUT);
    const admins = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        createAdmin(h(), superNow(), { displayName: `Test Admin ${String(i)}`, uiLocale: 'en' }),
      ),
    );
    const results = await Promise.all(
      admins.map((adminId) => errorCode(addAdminToMasjid(h(), superNow(), { masjidId: id, adminId, role: 'editor' }))),
    );
    expect(results.filter((r) => r === 'ok')).toHaveLength(5);
    expect(results.filter((r) => r === 'ADMIN_LIMIT_REACHED')).toHaveLength(3);
    expect(await raw('masjids').findOne({ _id: id })).toMatchObject({ admin_count: 5 });
    expect(await raw('masjid_admins').countDocuments({ masjid_id: id })).toBe(5);
    const member = (await raw('masjid_admins').findOne({ masjid_id: id }))?.['admin_id'] as UUID;
    expect(await errorCode(removeAdminFromMasjid(h(), superScope(SUPER_ID), { masjidId: id, adminId: member }))).toBe(
      'STEP_UP_REQUIRED',
    );
    await removeAdminFromMasjid(h(), superNow(), { masjidId: id, adminId: member });
    expect(await raw('masjids').findOne({ _id: id })).toMatchObject({ admin_count: 4 });
    const other = await createMasjid(h(), superNow(), MASJID_INPUT);
    await addAdminToMasjid(h(), superNow(), { masjidId: other.id, adminId: member, role: 'owner' });
    expect(
      await errorCode(addAdminToMasjid(h(), superNow(), { masjidId: other.id, adminId: member, role: 'owner' })),
    ).toBe('ALREADY_MEMBER');
    expect(await raw('masjids').findOne({ _id: other.id })).toMatchObject({ admin_count: 1 }); // rolled back
  });
});

describe('invites (04 R3)', () => {
  it('a new invite closes the previous one; single use; expiry; uniform failures; one winner under concurrency', async () => {
    const adminId = await createAdmin(h(), superNow(), { displayName: 'Test Admin Invite', uiLocale: 'hi' });
    const first = randomBytes(32);
    const second = randomBytes(32);
    const now = new Date();
    await createInvite(h(), superNow(), { adminId, purpose: 'register', tokenHash: first, now });
    await createInvite(h(), superNow(), { adminId, purpose: 'register', tokenHash: second, now });
    expect(await raw('admin_invites').countDocuments({ admin_id: adminId, open: true })).toBe(1);
    expect(await errorCode(consumeInvite(h(), publicScope(), { tokenHash: first }))).toBe('INVITE_INVALID'); // superseded
    const later = new Date(now.getTime() + INVITE_TTL_MS + 1000);
    expect(await errorCode(consumeInvite(h(), publicScope(), { tokenHash: second, now: later }))).toBe(
      'INVITE_INVALID',
    );
    const results = await Promise.all(
      Array.from({ length: 5 }, () => errorCode(consumeInvite(h(), publicScope(), { tokenHash: second }))),
    );
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'INVITE_INVALID')).toHaveLength(4);
    expect(await errorCode(consumeInvite(h(), publicScope(), { tokenHash: randomBytes(32) }))).toBe('INVITE_INVALID');
    expect(
      await t().db.collection('audit_log').findOne({ action: 'invite.consume', target_id: adminId.toHexString() }),
    ).toMatchObject({ actor_type: 'admin', actor_id: adminId, meta: { purpose: 'register' } });
    expect(await errorCode(consumeInvite(h(), deviceScope(new UUID()), { tokenHash: second }))).toBe('FORBIDDEN');
    const stored = await raw('admin_invites').findOne({ admin_id: adminId, open: false, used_at: { $exists: true } });
    expect(stored?.['token_hash']).toBeInstanceOf(Binary);
  });
});

describe('follows (02 §5 follow limit)', () => {
  const activeMasjid = async () => {
    const id = new UUID();
    await fixture('masjids', { _id: id, status: 'active', name: 'Test Masjid' });
    return id;
  };
  const newDevice = async () => {
    const id = new UUID();
    await fixture('devices', {
      _id: id,
      follow_count: 0,
      audience_pref: 'brothers',
      locale: 'ur',
      push_status: 'active',
      secret_hash: new Binary(randomBytes(32)),
      platform: 'android',
      privacy_version: 'draft-1',
      created_at: new Date(),
      last_seen_at: new Date(),
    });
    return deviceScope(id);
  };

  it('25 concurrent follows: exactly 20 succeed, counters and denormalized fields match', async () => {
    const device = await newDevice();
    const masjids = await Promise.all(Array.from({ length: 25 }, activeMasjid));
    const results = await Promise.all(masjids.map((id) => errorCode(followMasjid(h(), device, id))));
    expect(results.filter((r) => r === 'ok')).toHaveLength(20);
    expect(results.filter((r) => r === 'FOLLOW_LIMIT_REACHED')).toHaveLength(5);
    expect(await raw('devices').findOne({ _id: device.deviceId })).toMatchObject({ follow_count: 20 });
    expect(await raw('device_follows').countDocuments({ device_id: device.deviceId })).toBe(20);
    expect(await raw('device_follows').findOne({ device_id: device.deviceId })).toMatchObject({
      audience_pref: 'brothers',
      locale: 'ur',
      push_active: true,
      muted: false,
    });
    const followers = await raw('masjid_stats').countDocuments({ _id: { $in: masjids }, followers: 1 });
    expect(followers).toBe(20);
  });

  it('the same masjid followed 5 times at once: one follow, counted once; unfollow reverses it', async () => {
    const device = await newDevice();
    const id = await activeMasjid();
    const results = await Promise.all(Array.from({ length: 5 }, () => followMasjid(h(), device, id)));
    expect(results.filter((r) => r === 'followed')).toHaveLength(1);
    expect(results.filter((r) => r === 'already')).toHaveLength(4);
    expect(await raw('devices').findOne({ _id: device.deviceId })).toMatchObject({ follow_count: 1 });
    expect(await raw('masjid_stats').findOne({ _id: id })).toMatchObject({ followers: 1 });
    expect(await unfollowMasjid(h(), device, id)).toBe('unfollowed');
    expect(await unfollowMasjid(h(), device, id)).toBe('not_following');
    expect(await raw('devices').findOne({ _id: device.deviceId })).toMatchObject({ follow_count: 0 });
    expect(await raw('masjid_stats').findOne({ _id: id })).toMatchObject({ followers: 0 });
  });

  it('only active masjids can be followed, only by devices', async () => {
    const device = await newDevice();
    const pending = new UUID();
    await fixture('masjids', { _id: pending, status: 'pending' });
    expect(await errorCode(followMasjid(h(), device, pending))).toBe('MASJID_NOT_FOUND');
    expect(await errorCode(followMasjid(h(), systemScope(), pending))).toBe('FORBIDDEN');
    expect(await errorCode(followMasjid(h(), deviceScope(new UUID()), await activeMasjid()))).toBe('DEVICE_NOT_FOUND');
  });
});

describe('audit writes', () => {
  it('unknown actions, unlisted meta keys, oversized meta and anonymous actors are refused', async () => {
    const run = (fn: Parameters<typeof withTransaction>[2]) => errorCode(withTransaction(h(), superNow(), fn));
    expect(await run((ctx) => writeAudit(ctx, { action: 'masjid.explode' }))).toBe('AUDIT_ACTION');
    expect(await run((ctx) => writeAudit(ctx, { action: 'masjid.activate', meta: { phone: '9' } }))).toBe('AUDIT_META');
    expect(await run((ctx) => writeAudit(ctx, { action: 'masjid.suspend', meta: { reason: 'x'.repeat(5000) } }))).toBe(
      'AUDIT_META',
    );
    expect(
      await errorCode(withTransaction(h(), publicScope(), (ctx) => writeAudit(ctx, { action: 'masjid.activate' }))),
    ).toBe('AUDIT_ACTOR');
  });
});

describe('later-phase state functions', () => {
  it('exist with their names and throw NotImplementedError until their phase', () => {
    expect(() => recordAmeen(h(), deviceScope(new UUID()), new UUID())).toThrow(NotImplementedError);
  });
});
