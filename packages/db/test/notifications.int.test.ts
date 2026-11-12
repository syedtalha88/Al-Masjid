// PHASE_04 T4.5 / T4.6 / T4.7 — notification visibility and admin alert phones as the real process users: today's quota
// with the audience reach and the kill switch, the history (newest first, 30 a page, the post joined), the Super
// Admin's 24 h push stats (`mc_admin`), and admin push subscriptions — saved, replaced, capped at five, refused on
// another admin's endpoint — read and pruned by the worker's alert sender (`mc_system`). F65 (DECISIONS #159): each
// subscription hangs on the session that saved it; alerts go only to phones whose session still carries them.
import { randomBytes } from 'node:crypto';

import { Binary, type UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import {
  getNotificationStatus,
  getPushStats,
  listNotificationJobs,
  NOTIFICATION_PAGE_SIZE,
  quotaUsageId,
} from '../src/repos/index.ts';
import { adminScope, deviceScope, superScope, systemScope } from '../src/scope.ts';
import { buildDevSeed, seedId, writeDevSeed } from '../src/seed/index.ts';
import {
  getAlertTargets,
  MAX_ADMIN_PUSH_SUBSCRIPTIONS,
  pruneAdminPushSubscriptions,
  recordAlertDelivery,
  removeAdminPushSubscription,
  revokeAdminPasskeys,
  revokeAdminSessions,
  revokeSessions,
  saveAdminPushSubscription,
  sessionCarriesAlerts,
} from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { newId, newPublicId } from '../src/values.ts';

const NOW = new Date('2026-11-08T06:30:00Z');
const TODAY = '2026-11-08';
const ALPHA = seedId('masjid-alpha');
const SYSTEM = systemScope();

let test: TestDatabase | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asAdmin: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const sys = (): DbHandle => {
  if (!asSystem) throw new Error('no mc_system handle');
  return asSystem.handle;
};
const adm = (): DbHandle => {
  if (!asAdmin) throw new Error('no mc_admin handle');
  return asAdmin.handle;
};
const raw = (name: string) => t().db.collection<{ _id: UUID | string } & Record<string, unknown>>(name);
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof StateError) return error.code;
    throw error;
  }
};
const KEYS = { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) };
const owner = (masjid: UUID, adminId: UUID = newId()) =>
  adminScope({ adminId, masjids: [{ id: masjid, role: 'owner' }] });

/** A masjid copied from the seed's Alpha (validator-complete) with its own id and quota. */
async function masjid(quota = 8): Promise<UUID> {
  const seed = await raw('masjids').findOne({ _id: ALPHA }, { promoteLongs: false });
  if (!seed) throw new Error('no seed masjid');
  const id = newId();
  await raw('masjids').insertOne({
    ...seed,
    _id: id,
    follow_code: `T${id.toHexString().slice(0, 7).toUpperCase()}`,
    push_daily_quota: quota,
  });
  return id;
}

async function follower(masjidId: UUID, pref: 'brothers' | 'sisters', opts: { muted?: boolean; push?: boolean } = {}) {
  await raw('device_follows').insertOne({
    _id: newId(),
    device_id: newId(),
    masjid_id: masjidId,
    muted: opts.muted ?? false,
    audience_pref: pref,
    locale: 'en',
    push_active: opts.push ?? true,
    created_at: NOW,
  });
}

/** A notification job; `completed_at: null` in `extra` leaves the field out (a job not finished yet). */
async function job(masjidId: UUID, itemId: UUID, createdAt: Date, extra: Record<string, unknown> = {}) {
  const id = newId();
  const { completed_at: completedAt, ...rest } = extra;
  await raw('notification_jobs').insertOne({
    _id: id,
    item_id: itemId,
    masjid_id: masjidId,
    status: 'completed',
    audience: 'everyone',
    audience_targets: ['brothers', 'sisters'],
    targeted: 3,
    sent: 2,
    failed: 1,
    pruned: 0,
    pending_batches: 0,
    bypass_quota: false,
    created_at: createdAt,
    ...(completedAt === null ? {} : { completed_at: completedAt ?? createdAt }),
    ...rest,
  });
  return id;
}

async function admin(role: 'super_admin' | 'masjid_admin', locale: string, status = 'active'): Promise<UUID> {
  const id = newId();
  await raw('admin_users').insertOne({
    _id: id,
    display_name: 'Test Admin',
    role,
    status,
    ui_locale: locale,
    user_handle: new Binary(randomBytes(32)),
    undertaking_history: [],
    created_at: NOW,
    updated_at: NOW,
  });
  return id;
}
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A session of `adminId`: open at NOW, idle for another hour, absolute for two — unless `extra` says otherwise. */
async function session(adminId: UUID, extra: Record<string, unknown> = {}): Promise<UUID> {
  const id = newId();
  await raw('admin_sessions').insertOne(
    {
      _id: id,
      admin_id: adminId,
      token_hash: new Binary(randomBytes(32)),
      created_at: NOW,
      last_seen_at: NOW,
      idle_expires_at: new Date(NOW.getTime() + HOUR),
      absolute_expires_at: new Date(NOW.getTime() + 2 * HOUR),
      ...extra,
    },
    { bypassDocumentValidation: true },
  );
  return id;
}
const subscription = (n: number | string, sessionId: UUID) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/admin-${String(n)}`,
  ...KEYS,
  sessionId,
});
const endpointOf = (n: number | string) => `https://fcm.googleapis.com/fcm/send/admin-${String(n)}`;

beforeAll(async () => {
  test = await createTestDatabase('notifications');
  await runMigrations(t().db, MIGRATIONS);
  asSystem = await processUserHandle(t(), 'mc_system');
  asAdmin = await processUserHandle(t(), 'mc_admin');
  await writeDevSeed(asSystem.handle, SYSTEM, buildDevSeed({ now: NOW, today: TODAY }));
});

afterAll(async () => {
  await asSystem?.dispose();
  await asAdmin?.dispose();
  await test?.dispose();
});

describe('notification status and history (mc_admin)', () => {
  it('quota: today’s count, the limit, the next IST midnight, reach per audience and the kill switch', async () => {
    const id = await masjid(5);
    await follower(id, 'brothers');
    await follower(id, 'brothers');
    await follower(id, 'sisters');
    await follower(id, 'sisters', { muted: true });
    await follower(id, 'brothers', { push: false });
    await raw('push_quota_usage').insertOne({ _id: quotaUsageId(id, TODAY), masjid_id: id, day: TODAY, count: 2 });

    expect(await getNotificationStatus(adm(), owner(id), id, NOW)).toEqual({
      used: 2,
      limit: 5,
      resetsAt: new Date('2026-11-08T18:30:00.000Z'),
      paused: false,
      reach: { everyone: 3, brothers: 2, sisters: 1 },
    });
    await raw('app_settings').updateOne({ _id: 'global' }, { $set: { push_paused: true } });
    expect((await getNotificationStatus(adm(), owner(id), id, NOW)).paused).toBe(true);
    await raw('app_settings').updateOne({ _id: 'global' }, { $set: { push_paused: false } });

    const empty = await masjid();
    expect(await getNotificationStatus(adm(), owner(empty), empty, NOW)).toMatchObject({ used: 0, limit: 8 });
    expect(await code(getNotificationStatus(adm(), owner(ALPHA), id, NOW))).toBe('MASJID_NOT_FOUND');
    expect(await code(getNotificationStatus(adm(), owner(newId()), newId(), NOW))).not.toBe('ok');
  });

  it('history: newest first, 30 a page with a cursor, the post joined (or absent once purged)', async () => {
    const id = await masjid();
    // A post of this masjid (a copy of a seed announcement — the policy layer only joins the admin's own posts).
    const seedItem = await raw('items').findOne({ masjid_id: ALPHA, type: 'announcement' }, { promoteLongs: false });
    if (!seedItem) throw new Error('no seed announcement');
    const itemId = newId();
    await raw('items').insertOne({ ...seedItem, _id: itemId, masjid_id: id, public_id: newPublicId() });
    const total = NOTIFICATION_PAGE_SIZE + 2;
    for (let n = 0; n < total; n += 1) await job(id, itemId, new Date(NOW.getTime() - n * 60_000));
    const gone = await job(id, newId(), new Date(NOW.getTime() + 60_000), { status: 'running', completed_at: null });

    const first = await listNotificationJobs(adm(), owner(id), id);
    expect(first.rows).toHaveLength(NOTIFICATION_PAGE_SIZE);
    expect(first.rows[0]).toMatchObject({ id: gone.toHexString(true), status: 'running', targeted: 3, sent: 2 });
    expect(first.rows[0]?.item).toBeUndefined(); // purged post
    expect(first.rows[0]?.completedAt).toBeUndefined();
    expect(first.rows[1]).toMatchObject({
      status: 'completed',
      audience: 'everyone',
      failed: 1,
      completedAt: NOW.toISOString(),
      item: { id: itemId.toHexString(true), type: 'announcement' },
    });
    expect(first.next).not.toBeNull();

    const second = await listNotificationJobs(adm(), owner(id), id, { cursor: first.next ?? undefined });
    expect(second.rows).toHaveLength(total + 1 - NOTIFICATION_PAGE_SIZE);
    expect(second.next).toBeNull();
    const seen = new Set([...first.rows, ...second.rows].map((row) => row.id));
    expect(seen.size).toBe(total + 1); // no row twice, none missing

    const none = await masjid();
    expect(await listNotificationJobs(adm(), owner(none), none)).toEqual({ rows: [], next: null });
    expect(await code(listNotificationJobs(adm(), owner(ALPHA), id))).toBe('MASJID_NOT_FOUND');
  });

  it('push stats (Super Admin only): jobs since a time, running / failed, totals and the success rate', async () => {
    const since = new Date(NOW.getTime() + 10 * 60_000); // after every job of the other tests
    const superAdmin = superScope(newId());
    expect(await getPushStats(adm(), superAdmin, since)).toMatchObject({ jobs: 0, successRate: null, paused: false });

    const id = await masjid();
    const at = new Date(since.getTime() + 1000);
    await job(id, newId(), at);
    await job(id, newId(), at, { status: 'failed', sent: 0, failed: 0 });
    await job(id, newId(), at, { status: 'pending', sent: 0, failed: 0, targeted: 0, completed_at: null });
    await job(id, newId(), at, { status: 'completed', sent: 6, failed: 1, pruned: 2 });
    expect(await getPushStats(adm(), superAdmin, since)).toEqual({
      jobs: 4,
      running: 1,
      failedJobs: 1,
      sent: 8,
      failed: 2,
      pruned: 2,
      successRate: 0.8,
      paused: false,
    });
    expect(await code(getPushStats(adm(), owner(id), since))).toBe('FORBIDDEN');
  });
});

describe('admin push subscriptions (mc_admin) and alert targets (mc_system)', () => {
  it('saved per admin with its session, the same endpoint replaced, at most five kept (newest), removed idempotently', async () => {
    const adminId = await admin('masjid_admin', 'hi');
    const scope = owner(ALPHA, adminId);
    const first = await session(adminId);
    for (let n = 0; n < MAX_ADMIN_PUSH_SUBSCRIPTIONS + 2; n += 1)
      await saveAdminPushSubscription(
        adm(),
        scope,
        subscription(`${adminId.toHexString()}-${String(n)}`, first),
        new Date(NOW.getTime() + n * 1000),
      );
    const own = await raw('admin_push_subscriptions').find({ admin_id: adminId }).toArray();
    expect(own).toHaveLength(MAX_ADMIN_PUSH_SUBSCRIPTIONS);
    expect(own.map((row) => row['endpoint'])).not.toContain(endpointOf(`${adminId.toHexString()}-0`)); // oldest gone
    expect(own.every((row) => (row['session_id'] as UUID).equals(first))).toBe(true);

    // The app sends the subscription again after a new sign-in: it moves to the new session.
    const second = await session(adminId);
    const again = subscription(`${adminId.toHexString()}-6`, second);
    await saveAdminPushSubscription(adm(), scope, { ...again, auth: 'B'.repeat(22) }, NOW);
    expect(await raw('admin_push_subscriptions').countDocuments({ admin_id: adminId })).toBe(
      MAX_ADMIN_PUSH_SUBSCRIPTIONS,
    );
    expect(await raw('admin_push_subscriptions').findOne({ endpoint: again.endpoint })).toMatchObject({
      auth: 'B'.repeat(22),
      session_id: second,
    });

    await removeAdminPushSubscription(adm(), scope, again.endpoint);
    await removeAdminPushSubscription(adm(), scope, again.endpoint); // idempotent
    expect(await raw('admin_push_subscriptions').findOne({ endpoint: again.endpoint })).toBeNull();
  });

  it('another admin’s endpoint is PUSH_ENDPOINT_IN_USE; only admins may save; only the worker reads targets', async () => {
    const first = await admin('masjid_admin', 'en');
    const second = await admin('masjid_admin', 'en');
    const shared = `shared-${first.toHexString()}`;
    await saveAdminPushSubscription(adm(), owner(ALPHA, first), subscription(shared, await session(first)), NOW);
    const other = subscription(shared, await session(second));
    expect(await code(saveAdminPushSubscription(adm(), owner(ALPHA, second), other, NOW))).toBe('PUSH_ENDPOINT_IN_USE');
    expect(await code(saveAdminPushSubscription(adm(), deviceScope(newId()), other, NOW))).toBe('FORBIDDEN');
    expect(await code(removeAdminPushSubscription(adm(), SYSTEM, other.endpoint))).toBe('FORBIDDEN');
    expect(await code(getAlertTargets(adm(), owner(ALPHA, first), { kind: 'super' }, NOW))).toBe('FORBIDDEN');
    expect(await code(recordAlertDelivery(adm(), owner(ALPHA, first), { delivered: [], gone: [] }, NOW))).toBe(
      'FORBIDDEN',
    );
    expect(await code(pruneAdminPushSubscriptions(adm(), owner(ALPHA, first), NOW))).toBe('FORBIDDEN');
  });

  it('F65: a subscription is saved only on a session of the same admin that is still open', async () => {
    const self = await admin('masjid_admin', 'en');
    const stranger = await admin('masjid_admin', 'en');
    const label = `own-${self.toHexString()}`;
    const save = (sessionId: UUID) =>
      code(saveAdminPushSubscription(adm(), owner(ALPHA, self), subscription(label, sessionId), NOW));
    expect(await save(newId())).toBe('FORBIDDEN'); // no such session
    expect(await save(await session(stranger))).toBe('FORBIDDEN'); // someone else's
    expect(await save(await session(self, { revoked_at: NOW, revoked_reason: 'logout' }))).toBe('FORBIDDEN');
    expect(await raw('admin_push_subscriptions').countDocuments({ admin_id: self })).toBe(0);
    expect(await save(await session(self))).toBe('ok');
  });

  it('revoked sessions or passkeys, or signing out everywhere, stop alerts to every phone of the admin (#142)', async () => {
    const phones = (adminId: UUID) => raw('admin_push_subscriptions').countDocuments({ admin_id: adminId });
    const owner2 = superScope(newId(), NOW); // the Super Admin acting, step-up fresh
    const subscribe = async (adminId: UUID, label: string) => {
      const a = await session(adminId);
      const b = await session(adminId);
      await saveAdminPushSubscription(adm(), owner(ALPHA, adminId), subscription(`${label}-a`, a), NOW);
      await saveAdminPushSubscription(adm(), owner(ALPHA, adminId), subscription(`${label}-b`, b), NOW);
      return [a, b] as const;
    };

    const lostPhone = await admin('masjid_admin', 'en');
    await subscribe(lostPhone, `lost-${lostPhone.toHexString()}`);
    await revokeAdminSessions(adm(), owner2, { adminId: lostPhone, now: NOW });
    expect(await phones(lostPhone)).toBe(0);

    const stolen = await admin('masjid_admin', 'en');
    await subscribe(stolen, `stolen-${stolen.toHexString()}`);
    await revokeAdminPasskeys(adm(), owner2, { adminId: stolen, now: NOW });
    expect(await phones(stolen)).toBe(0);

    // F65: ending ONE session — from that phone or from another one's session list — stops that phone's alerts.
    const self = await admin('masjid_admin', 'en');
    const label = `self-${self.toHexString()}`;
    const [one] = await subscribe(self, label);
    await revokeSessions(adm(), owner(ALPHA, self), { sessionId: one, reason: 'revoked_by_admin', now: NOW });
    expect(await raw('admin_push_subscriptions').find({ admin_id: self }).toArray()).toMatchObject([
      { endpoint: endpointOf(`${label}-b`) },
    ]);
    await revokeSessions(adm(), owner(ALPHA, self), { reason: 'revoked_by_admin', now: NOW });
    expect(await phones(self)).toBe(0); // everywhere
  });

  it('targets: active Super Admins or the named active admins, each in its app language; delivery noted, gone pruned', async () => {
    await raw('admin_push_subscriptions').deleteMany({});
    const superUrdu = await admin('super_admin', 'ur');
    const superOff = await admin('super_admin', 'en', 'disabled');
    const telugu = await admin('masjid_admin', 'te');
    const urduSession = await session(superUrdu);
    await saveAdminPushSubscription(adm(), superScope(superUrdu), subscription('super-ur-1', urduSession), NOW);
    await saveAdminPushSubscription(adm(), superScope(superUrdu), subscription('super-ur-2', urduSession), NOW);
    await saveAdminPushSubscription(
      adm(),
      superScope(superOff),
      subscription('super-off', await session(superOff)),
      NOW,
    );
    await saveAdminPushSubscription(adm(), owner(ALPHA, telugu), subscription('te', await session(telugu)), NOW);

    const supers = await getAlertTargets(sys(), SYSTEM, { kind: 'super' }, NOW);
    expect(supers.map((row) => row.endpoint).sort()).toEqual(
      [endpointOf('super-ur-1'), endpointOf('super-ur-2')].sort(),
    );
    expect(supers.every((row) => row.locale === 'ur')).toBe(true);
    const named = await getAlertTargets(sys(), SYSTEM, { kind: 'admins', adminIds: [telugu, superOff] }, NOW);
    expect(named).toEqual([expect.objectContaining({ endpoint: endpointOf('te'), locale: 'te' })]);
    expect(await getAlertTargets(sys(), SYSTEM, { kind: 'admins', adminIds: [newId()] }, NOW)).toEqual([]);

    const [kept, gone] = supers;
    if (!kept || !gone) throw new Error('two Super Admin phones');
    await recordAlertDelivery(sys(), SYSTEM, { delivered: [kept.id], gone: [gone.id] }, NOW);
    expect(await raw('admin_push_subscriptions').findOne({ _id: kept.id })).toMatchObject({ last_ok_at: NOW });
    expect(await raw('admin_push_subscriptions').findOne({ _id: gone.id })).toBeNull();
    await recordAlertDelivery(sys(), SYSTEM, { delivered: [], gone: [] }, NOW); // nothing to do
  });

  it('F65: a session carries alerts until it is revoked or expires — a Super Admin’s until it is revoked (#168)', () => {
    const at = (ms: number) => new Date(NOW.getTime() + ms);
    const open = { last_seen_at: NOW, idle_expires_at: at(HOUR), absolute_expires_at: at(2 * HOUR) };
    expect(sessionCarriesAlerts(open, 'masjid_admin', NOW)).toBe(true);
    expect(sessionCarriesAlerts(open, 'masjid_admin', at(HOUR))).toBe(false); // idle expiry reached
    expect(sessionCarriesAlerts({ ...open, idle_expires_at: at(3 * HOUR) }, 'masjid_admin', at(2 * HOUR))).toBe(false);
    expect(sessionCarriesAlerts({ ...open, revoked_at: NOW }, 'masjid_admin', NOW)).toBe(false);
    // The Super Admin's short session has long expired: takedown alerts still reach the phone…
    expect(sessionCarriesAlerts(open, 'super_admin', at(5 * DAY))).toBe(true);
    // …however long it has not been used (owner, O44)…
    expect(sessionCarriesAlerts(open, 'super_admin', at(400 * DAY))).toBe(true);
    // …until it is revoked (sign-out, the session list, a ★ revoke).
    expect(sessionCarriesAlerts({ ...open, revoked_at: NOW }, 'super_admin', NOW)).toBe(false);
  });

  it('F65: no alert to a phone whose session expired, was revoked, is gone, or was never linked; the daily prune deletes them', async () => {
    await raw('admin_push_subscriptions').deleteMany({});
    const masjidAdmin = await admin('masjid_admin', 'en');
    const superAdmin = await admin('super_admin', 'en');
    const mine = owner(ALPHA, masjidAdmin);
    const tag = masjidAdmin.toHexString();
    const save = async (scope: Parameters<typeof saveAdminPushSubscription>[1], name: string, sessionId: UUID) => {
      await saveAdminPushSubscription(adm(), scope, subscription(`${name}-${tag}`, sessionId), NOW);
      return endpointOf(`${name}-${tag}`);
    };
    const live = await save(mine, 'live', await session(masjidAdmin));
    const expiring = await session(masjidAdmin);
    const expired = await save(mine, 'expired', expiring);
    const revoking = await session(masjidAdmin);
    const revoked = await save(mine, 'revoked', revoking);
    const deleting = await session(masjidAdmin);
    const orphan = await save(mine, 'orphan', deleting);
    const legacy = endpointOf(`legacy-${tag}`); // saved before F65: no session
    await raw('admin_push_subscriptions').insertOne({
      _id: newId(),
      admin_id: masjidAdmin,
      endpoint: legacy,
      ...KEYS,
      created_at: NOW,
    });
    const superPhone = await save(superScope(superAdmin), 'super', await session(superAdmin));
    // A Super Admin phone whose session was last used a year ago still hears alerts (owner, O44 — #168).
    const superOld = await save(
      superScope(superAdmin),
      'super-old',
      await session(superAdmin, { last_seen_at: new Date(NOW.getTime() - 365 * DAY) }),
    );

    // Things happen to the sessions after the phones subscribed (raw writes: what time and other code paths do).
    await raw('admin_sessions').updateOne(
      { _id: expiring },
      { $set: { idle_expires_at: new Date(NOW.getTime() - 1) } },
      { bypassDocumentValidation: true },
    );
    await raw('admin_sessions').updateOne(
      { _id: revoking },
      { $set: { revoked_at: NOW, revoked_reason: 'credential_revoked' } },
      { bypassDocumentValidation: true },
    );
    await raw('admin_sessions').deleteOne({ _id: deleting });

    const to = { kind: 'admins', adminIds: [masjidAdmin, superAdmin] } as const;
    const endpoints = async (now: Date) => (await getAlertTargets(sys(), SYSTEM, to, now)).map((row) => row.endpoint);
    expect((await endpoints(NOW)).sort()).toEqual([live, superPhone, superOld].sort());
    // Two hours on, the masjid admin's session has run out; the Super Admin's phones still hear alerts.
    expect((await endpoints(new Date(NOW.getTime() + 2 * HOUR))).sort()).toEqual([superPhone, superOld].sort());

    expect(await pruneAdminPushSubscriptions(sys(), SYSTEM, NOW)).toBe(4);
    const left = await raw('admin_push_subscriptions')
      .find({ admin_id: { $in: [masjidAdmin, superAdmin] } })
      .toArray();
    expect(left.map((row) => row['endpoint']).sort()).toEqual([live, superPhone, superOld].sort());
    for (const gone of [expired, revoked, orphan, legacy])
      expect(await raw('admin_push_subscriptions').findOne({ endpoint: gone })).toBeNull();
    expect(await pruneAdminPushSubscriptions(sys(), SYSTEM, NOW)).toBe(0); // idempotent
    // An admin who is disabled later: their phone is not a target, and the next prune removes it.
    await raw('admin_users').updateOne({ _id: masjidAdmin }, { $set: { status: 'disabled' } });
    expect((await endpoints(NOW)).sort()).toEqual([superPhone, superOld].sort());
    expect(await pruneAdminPushSubscriptions(sys(), SYSTEM, NOW)).toBe(1);
  });
});
