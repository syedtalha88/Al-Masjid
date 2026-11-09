// PHASE_04 T4.5 / T4.6 / T4.7 — notification visibility and admin alert phones as the real process users: today's quota
// with the audience reach and the kill switch, the history (newest first, 30 a page, the post joined), the Super
// Admin's 24 h push stats (`mc_admin`), and admin push subscriptions — saved, replaced, capped at five, refused on
// another admin's endpoint — read and pruned by the worker's alert sender (`mc_system`).
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
  recordAlertDelivery,
  removeAdminPushSubscription,
  revokeAdminPasskeys,
  revokeAdminSessions,
  revokeSessions,
  saveAdminPushSubscription,
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
const subscription = (n: number | string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/admin-${String(n)}`,
  ...KEYS,
});

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
  it('saved per admin, the same endpoint replaced, at most five kept (newest), removed idempotently', async () => {
    const adminId = await admin('masjid_admin', 'hi');
    const scope = owner(ALPHA, adminId);
    for (let n = 0; n < MAX_ADMIN_PUSH_SUBSCRIPTIONS + 2; n += 1)
      await saveAdminPushSubscription(
        adm(),
        scope,
        subscription(`${adminId.toHexString()}-${String(n)}`),
        new Date(NOW.getTime() + n * 1000),
      );
    const own = await raw('admin_push_subscriptions').find({ admin_id: adminId }).toArray();
    expect(own).toHaveLength(MAX_ADMIN_PUSH_SUBSCRIPTIONS);
    expect(own.map((row) => row['endpoint'])).not.toContain(subscription(`${adminId.toHexString()}-0`).endpoint); // oldest gone

    const again = subscription(`${adminId.toHexString()}-6`);
    await saveAdminPushSubscription(adm(), scope, { ...again, auth: 'B'.repeat(22) }, NOW);
    expect(await raw('admin_push_subscriptions').countDocuments({ admin_id: adminId })).toBe(
      MAX_ADMIN_PUSH_SUBSCRIPTIONS,
    );
    expect(await raw('admin_push_subscriptions').findOne({ endpoint: again.endpoint })).toMatchObject({
      auth: 'B'.repeat(22),
    });

    await removeAdminPushSubscription(adm(), scope, again.endpoint);
    await removeAdminPushSubscription(adm(), scope, again.endpoint); // idempotent
    expect(await raw('admin_push_subscriptions').findOne({ endpoint: again.endpoint })).toBeNull();
  });

  it('another admin’s endpoint is PUSH_ENDPOINT_IN_USE; only admins may save; only the worker reads targets', async () => {
    const first = await admin('masjid_admin', 'en');
    const second = await admin('masjid_admin', 'en');
    const shared = subscription(`shared-${first.toHexString()}`);
    await saveAdminPushSubscription(adm(), owner(ALPHA, first), shared, NOW);
    expect(await code(saveAdminPushSubscription(adm(), owner(ALPHA, second), shared, NOW))).toBe(
      'PUSH_ENDPOINT_IN_USE',
    );
    expect(await code(saveAdminPushSubscription(adm(), deviceScope(newId()), shared, NOW))).toBe('FORBIDDEN');
    expect(await code(removeAdminPushSubscription(adm(), SYSTEM, shared.endpoint))).toBe('FORBIDDEN');
    expect(await code(getAlertTargets(adm(), owner(ALPHA, first), { kind: 'super' }))).toBe('FORBIDDEN');
    expect(await code(recordAlertDelivery(adm(), owner(ALPHA, first), { delivered: [], gone: [] }, NOW))).toBe(
      'FORBIDDEN',
    );
  });

  it('revoked sessions or passkeys, or signing out everywhere, stop alerts to every phone of the admin (#142)', async () => {
    const session = async (adminId: UUID) => {
      const id = newId();
      await raw('admin_sessions').insertOne(
        {
          _id: id,
          admin_id: adminId,
          token_hash: new Binary(randomBytes(32)),
          created_at: NOW,
          last_seen_at: NOW,
          idle_expires_at: new Date(NOW.getTime() + 3_600_000),
          absolute_expires_at: new Date(NOW.getTime() + 7_200_000),
        },
        { bypassDocumentValidation: true },
      );
      return id;
    };
    const phones = (adminId: UUID) => raw('admin_push_subscriptions').countDocuments({ admin_id: adminId });
    const owner2 = superScope(newId(), NOW); // the Super Admin acting, step-up fresh
    const subscribe = async (adminId: UUID, label: string) => {
      await saveAdminPushSubscription(adm(), owner(ALPHA, adminId), subscription(`${label}-a`), NOW);
      await saveAdminPushSubscription(adm(), owner(ALPHA, adminId), subscription(`${label}-b`), NOW);
    };

    const lostPhone = await admin('masjid_admin', 'en');
    await subscribe(lostPhone, `lost-${lostPhone.toHexString()}`);
    await revokeAdminSessions(adm(), owner2, { adminId: lostPhone, now: NOW });
    expect(await phones(lostPhone)).toBe(0);

    const stolen = await admin('masjid_admin', 'en');
    await subscribe(stolen, `stolen-${stolen.toHexString()}`);
    await revokeAdminPasskeys(adm(), owner2, { adminId: stolen, now: NOW });
    expect(await phones(stolen)).toBe(0);

    const self = await admin('masjid_admin', 'en');
    await subscribe(self, `self-${self.toHexString()}`);
    const one = await session(self);
    await session(self);
    await revokeSessions(adm(), owner(ALPHA, self), { sessionId: one, reason: 'revoked_by_admin', now: NOW });
    expect(await phones(self)).toBe(2); // one device signed out: that app removes its own subscription
    await revokeSessions(adm(), owner(ALPHA, self), { reason: 'revoked_by_admin', now: NOW });
    expect(await phones(self)).toBe(0); // everywhere
  });

  it('targets: active Super Admins or the named active admins, each in its app language; delivery noted, gone pruned', async () => {
    await raw('admin_push_subscriptions').deleteMany({});
    const superUrdu = await admin('super_admin', 'ur');
    const superOff = await admin('super_admin', 'en', 'disabled');
    const telugu = await admin('masjid_admin', 'te');
    await saveAdminPushSubscription(adm(), superScope(superUrdu), subscription('super-ur-1'), NOW);
    await saveAdminPushSubscription(adm(), superScope(superUrdu), subscription('super-ur-2'), NOW);
    await saveAdminPushSubscription(adm(), superScope(superOff), subscription('super-off'), NOW);
    await saveAdminPushSubscription(adm(), owner(ALPHA, telugu), subscription('te'), NOW);

    const supers = await getAlertTargets(sys(), SYSTEM, { kind: 'super' });
    expect(supers.map((row) => row.endpoint).sort()).toEqual(
      [subscription('super-ur-1').endpoint, subscription('super-ur-2').endpoint].sort(),
    );
    expect(supers.every((row) => row.locale === 'ur')).toBe(true);
    const named = await getAlertTargets(sys(), SYSTEM, { kind: 'admins', adminIds: [telugu, superOff] });
    expect(named).toEqual([expect.objectContaining({ endpoint: subscription('te').endpoint, locale: 'te' })]);
    expect(await getAlertTargets(sys(), SYSTEM, { kind: 'admins', adminIds: [newId()] })).toEqual([]);

    const [kept, gone] = supers;
    if (!kept || !gone) throw new Error('two Super Admin phones');
    await recordAlertDelivery(sys(), SYSTEM, { delivered: [kept.id], gone: [gone.id] }, NOW);
    expect(await raw('admin_push_subscriptions').findOne({ _id: kept.id })).toMatchObject({ last_ok_at: NOW });
    expect(await raw('admin_push_subscriptions').findOne({ _id: gone.id })).toBeNull();
    await recordAlertDelivery(sys(), SYSTEM, { delivered: [], gone: [] }, NOW); // nothing to do
  });
});
