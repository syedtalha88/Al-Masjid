// PHASE_04 T4.2 / T4.4 — push state as the real process users: a device stores and removes its subscription with the
// follow mirror (`mc_public`), and the worker's fan-out state (`mc_system`): keyset pages by audience / mute / push,
// resumable page records, batch counters and completion, dead subscriptions, the sweeper's and stuck-job detector's
// queries, the kill switch and the notification content (no private dua name). Other scopes have no cell here.
import { Binary, Long, type UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { adminScope, deviceScope, systemScope } from '../src/scope.ts';
import { buildDevSeed, seedId, writeDevSeed } from '../src/seed/index.ts';
import {
  beginFanout,
  completeIfDone,
  failJob,
  failStuckJobs,
  fanoutPage,
  getFanoutJob,
  getPushContent,
  getPushSubscriptions,
  isPushPaused,
  listStalledPendingJobs,
  markSubscriptionsDead,
  recordBatchResult,
  recordFanoutPage,
  setDevicePush,
} from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { newId, newPublicId } from '../src/values.ts';

const NOW = new Date('2026-11-08T06:30:00Z');
const TODAY = '2026-11-08';
const ALPHA = seedId('masjid-alpha');
const SYSTEM = systemScope();

let test: TestDatabase | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asPublic: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const sys = (): DbHandle => {
  if (!asSystem) throw new Error('no mc_system handle');
  return asSystem.handle;
};
const pub = (): DbHandle => {
  if (!asPublic) throw new Error('no mc_public handle');
  return asPublic.handle;
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

const endpoint = (n: number | string) => `https://fcm.googleapis.com/fcm/send/test-${String(n)}`;
const KEYS = { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) };

/** A device following `masjid` with its follow row (denormalized fields as the data layer writes them). */
async function device(
  masjid: UUID,
  opts: { pref?: 'brothers' | 'sisters'; locale?: 'en' | 'hi' | 'ur' | 'te'; muted?: boolean; push?: boolean } = {},
) {
  const id = newId();
  const push = opts.push ?? true;
  await raw('devices').insertOne({
    _id: id,
    secret_hash: new Binary(Buffer.alloc(32, 1)),
    locale: opts.locale ?? 'en',
    audience_pref: opts.pref ?? 'brothers',
    platform: 'android',
    push_status: push ? 'active' : 'none',
    ...(push ? { push_endpoint: endpoint(id.toHexString()), push_p256dh: KEYS.p256dh, push_auth: KEYS.auth } : {}),
    privacy_version: 'draft-1',
    follow_count: 1,
    created_at: NOW,
    last_seen_at: NOW,
  });
  await raw('device_follows').insertOne({
    _id: newId(),
    device_id: id,
    masjid_id: masjid,
    muted: opts.muted ?? false,
    audience_pref: opts.pref ?? 'brothers',
    locale: opts.locale ?? 'en',
    push_active: push,
    created_at: NOW,
  });
  return id;
}

/** A fresh masjid id with no follows (the fan-out tests count exact recipients; follows need no masjid document). */
const emptyMasjid = (): Promise<UUID> => Promise.resolve(newId());

async function pendingJob(masjid: UUID, targets: string[] = ['brothers', 'sisters'], createdAt = NOW) {
  const id = newId();
  await raw('notification_jobs').insertOne({
    _id: id,
    item_id: newId(),
    masjid_id: masjid,
    status: 'pending',
    audience: targets.length === 2 ? 'everyone' : targets[0],
    audience_targets: targets,
    targeted: 0,
    sent: 0,
    failed: 0,
    pruned: 0,
    pending_batches: 0,
    bypass_quota: false,
    created_at: createdAt,
  });
  return id;
}

beforeAll(async () => {
  test = await createTestDatabase('push-state');
  await runMigrations(t().db, MIGRATIONS);
  asSystem = await processUserHandle(t(), 'mc_system');
  asPublic = await processUserHandle(t(), 'mc_public');
  await writeDevSeed(asSystem.handle, SYSTEM, buildDevSeed({ now: NOW, today: TODAY }));
});

afterAll(async () => {
  await asSystem?.dispose();
  await asPublic?.dispose();
  await test?.dispose();
});

describe('setDevicePush (device scope, mc_public)', () => {
  it('stores the subscription and turns push on for every follow; removing it turns them off', async () => {
    const masjid = await emptyMasjid();
    const id = await device(masjid, { push: false });
    await device(masjid, { push: false }); // another device: untouched
    await setDevicePush(pub(), deviceScope(id), { endpoint: endpoint('own'), ...KEYS }, NOW);
    expect(await raw('devices').findOne({ _id: id })).toMatchObject({
      push_status: 'active',
      push_endpoint: endpoint('own'),
      push_p256dh: KEYS.p256dh,
      push_auth: KEYS.auth,
      push_updated_at: NOW,
    });
    expect(await raw('device_follows').countDocuments({ masjid_id: masjid, push_active: true })).toBe(1);

    await setDevicePush(pub(), deviceScope(id), null, NOW);
    const off = await raw('devices').findOne({ _id: id });
    expect(off).toMatchObject({ push_status: 'none' });
    expect(off).not.toHaveProperty('push_endpoint');
    expect(off).not.toHaveProperty('push_auth');
    expect(await raw('device_follows').countDocuments({ masjid_id: masjid, push_active: true })).toBe(0);
  });

  it('an endpoint another device record holds is PUSH_ENDPOINT_IN_USE (nothing changes)', async () => {
    const masjid = await emptyMasjid();
    const first = await device(masjid, { push: false });
    const second = await device(masjid, { push: false });
    await setDevicePush(pub(), deviceScope(first), { endpoint: endpoint('shared'), ...KEYS }, NOW);
    expect(await code(setDevicePush(pub(), deviceScope(second), { endpoint: endpoint('shared'), ...KEYS }, NOW))).toBe(
      'PUSH_ENDPOINT_IN_USE',
    );
    expect(await raw('devices').findOne({ _id: second })).toMatchObject({ push_status: 'none' });
  });

  it('only a device scope; an unknown device is DEVICE_NOT_FOUND', async () => {
    expect(await code(setDevicePush(pub(), deviceScope(newId()), null, NOW))).toBe('DEVICE_NOT_FOUND');
    expect(await code(setDevicePush(pub(), SYSTEM, null, NOW))).toBe('FORBIDDEN');
  });
});

describe('fan-out state (system scope, mc_system)', () => {
  it('pages recipients in device-id order by audience, never muted or push-off follows', async () => {
    const masjid = await emptyMasjid();
    const brothers = await Promise.all([1, 2, 3].map(() => device(masjid, { pref: 'brothers', locale: 'hi' })));
    const sisters = await Promise.all([1, 2].map(() => device(masjid, { pref: 'sisters', locale: 'ur' })));
    await device(masjid, { pref: 'brothers', muted: true });
    await device(masjid, { pref: 'sisters', push: false });
    const order = (ids: UUID[]) => ids.map((id) => id.toHexString()).sort();

    const all = await fanoutPage(sys(), SYSTEM, {
      masjidId: masjid,
      targets: ['brothers', 'sisters'],
      after: undefined,
      limit: 100,
    });
    expect(all.map((row) => row.deviceId.toHexString())).toEqual(order([...brothers, ...sisters]));
    const onlySisters = await fanoutPage(sys(), SYSTEM, {
      masjidId: masjid,
      targets: ['sisters'],
      after: undefined,
      limit: 100,
    });
    expect(onlySisters.map((row) => row.deviceId.toHexString())).toEqual(order(sisters));
    expect(onlySisters.every((row) => row.locale === 'ur')).toBe(true);

    // keyset: two pages of 3 + 2 reach everyone exactly once
    const first = await fanoutPage(sys(), SYSTEM, {
      masjidId: masjid,
      targets: ['brothers', 'sisters'],
      after: undefined,
      limit: 3,
    });
    const second = await fanoutPage(sys(), SYSTEM, {
      masjidId: masjid,
      targets: ['brothers', 'sisters'],
      after: first.at(-1)?.deviceId,
      limit: 3,
    });
    expect([...first, ...second].map((row) => row.deviceId.toHexString())).toEqual(order([...brothers, ...sisters]));
  });

  it('the fan-out page query uses the fan-out index', async () => {
    const plan = await raw('device_follows')
      .find({ masjid_id: ALPHA, muted: false, push_active: true, audience_pref: { $in: ['brothers', 'sisters'] } })
      .sort({ device_id: 1 })
      .limit(1000)
      .explain('queryPlanner');
    const text = JSON.stringify(plan);
    expect(text).toContain('IXSCAN');
    expect(text).not.toContain('COLLSCAN');
    expect(text).not.toContain('"stage":"SORT"');
  });

  it('a job runs once, records each page once, completes when its last batch is counted off', async () => {
    const masjid = await emptyMasjid();
    const jobId = await pendingJob(masjid);
    const job = await beginFanout(sys(), SYSTEM, jobId, NOW);
    expect(job).toMatchObject({ status: 'running', fanoutPage: 0, fanoutDone: false });
    expect(await beginFanout(sys(), SYSTEM, jobId, new Date(NOW.getTime() + 1))).toMatchObject({ status: 'running' });
    expect((await raw('notification_jobs').findOne({ _id: jobId }))?.['started_at']).toEqual(NOW); // not restarted

    const cursor = newId();
    const page0 = { page: 0, cursor, batches: 2, targeted: 1500, done: false };
    expect(await recordFanoutPage(sys(), SYSTEM, jobId, page0, NOW)).toBe(true);
    expect(await recordFanoutPage(sys(), SYSTEM, jobId, page0, NOW)).toBe(false); // a retried fan-out: no double count
    expect(
      await recordFanoutPage(
        sys(),
        SYSTEM,
        jobId,
        { page: 1, cursor: undefined, batches: 0, targeted: 0, done: true },
        NOW,
      ),
    ).toBe(true);
    expect(await getFanoutJob(sys(), SYSTEM, jobId)).toMatchObject({
      fanoutPage: 2,
      fanoutCursor: cursor,
      fanoutDone: true,
      pendingBatches: 2,
    });
    expect(await completeIfDone(sys(), SYSTEM, jobId, NOW)).toBe(false);

    await recordBatchResult(sys(), SYSTEM, jobId, { sent: 990, failed: 5, pruned: 5 }, NOW);
    expect((await getFanoutJob(sys(), SYSTEM, jobId))?.status).toBe('running');
    await recordBatchResult(sys(), SYSTEM, jobId, { sent: 500, failed: 0, pruned: 0 }, NOW);
    expect(await raw('notification_jobs').findOne({ _id: jobId })).toMatchObject({
      status: 'completed',
      targeted: 1500,
      sent: 1490,
      failed: 5,
      pruned: 5,
      pending_batches: 0,
      completed_at: NOW,
    });
    expect(await failJob(sys(), SYSTEM, jobId, 'late', NOW)).toBe(false); // completed stays completed
  });

  it('batches may count off before the fan-out records their page (the balance dips below 0; DECISIONS #140)', async () => {
    const masjid = await emptyMasjid();
    const jobId = await pendingJob(masjid);
    await beginFanout(sys(), SYSTEM, jobId, NOW);
    // The fan-out enqueued its last page's two batches; both finish before it records the page.
    await recordBatchResult(sys(), SYSTEM, jobId, { sent: 3, failed: 0, pruned: 0 }, NOW);
    await recordBatchResult(sys(), SYSTEM, jobId, { sent: 2, failed: 1, pruned: 0 }, NOW);
    expect(await getFanoutJob(sys(), SYSTEM, jobId)).toMatchObject({ status: 'running', pendingBatches: -2 });
    const last = { page: 0, cursor: newId(), batches: 2, targeted: 6, done: true };
    expect(await recordFanoutPage(sys(), SYSTEM, jobId, last, NOW)).toBe(true);
    expect(await completeIfDone(sys(), SYSTEM, jobId, NOW)).toBe(true); // the fan-out's own final check
    expect(await raw('notification_jobs').findOne({ _id: jobId })).toMatchObject({
      status: 'completed',
      targeted: 6,
      sent: 5,
      failed: 1,
      pending_batches: 0,
    });
  });

  it('subscriptions: only active ones are read; gone ones are marked dead only while the endpoint is unchanged', async () => {
    const masjid = await emptyMasjid();
    const a = await device(masjid);
    const b = await device(masjid);
    const off = await device(masjid, { push: false });
    const rows = await getPushSubscriptions(sys(), SYSTEM, [a, b, off]);
    expect(rows.map((row) => row.deviceId.toHexString()).sort()).toEqual([a, b].map((id) => id.toHexString()).sort());

    const marked = await markSubscriptionsDead(
      sys(),
      SYSTEM,
      [
        { deviceId: a, endpoint: endpoint(a.toHexString()) },
        { deviceId: b, endpoint: endpoint('an-older-one') }, // b re-subscribed meanwhile
      ],
      NOW,
    );
    expect(marked).toBe(1);
    expect(await raw('devices').findOne({ _id: a })).toMatchObject({ push_status: 'dead' });
    expect(await raw('device_follows').findOne({ device_id: a })).toMatchObject({ push_active: false });
    expect(await raw('devices').findOne({ _id: b })).toMatchObject({ push_status: 'active' });
    expect(await raw('device_follows').findOne({ device_id: b })).toMatchObject({ push_active: true });
  });

  it('the sweeper sees old pending jobs; the detector fails running jobs without progress', async () => {
    const masjid = await emptyMasjid();
    const old = await pendingJob(masjid, ['brothers', 'sisters'], new Date(NOW.getTime() - 5 * 60_000));
    const fresh = await pendingJob(masjid, ['brothers', 'sisters'], NOW);
    const stalled = await listStalledPendingJobs(sys(), SYSTEM, new Date(NOW.getTime() - 2 * 60_000), 100);
    expect(stalled.map((id) => id.toHexString())).toContain(old.toHexString());
    expect(stalled.map((id) => id.toHexString())).not.toContain(fresh.toHexString());

    await beginFanout(sys(), SYSTEM, old, new Date(NOW.getTime() - 20 * 60_000));
    await beginFanout(sys(), SYSTEM, fresh, NOW);
    const failed = await failStuckJobs(sys(), SYSTEM, new Date(NOW.getTime() - 10 * 60_000), NOW);
    expect(failed.map((row) => row.jobId.toHexString())).toEqual([old.toHexString()]);
    expect(await raw('notification_jobs').findOne({ _id: old })).toMatchObject({
      status: 'failed',
      last_error: 'no progress for 10 minutes',
    });
    expect((await getFanoutJob(sys(), SYSTEM, fresh))?.status).toBe('running');
  });

  it('the kill switch', async () => {
    expect(await isPushPaused(sys(), SYSTEM)).toBe(false);
    await raw('app_settings').updateOne({ _id: 'global' }, { $set: { push_paused: true } });
    expect(await isPushPaused(sys(), SYSTEM)).toBe(true);
    await raw('app_settings').updateOne({ _id: 'global' }, { $set: { push_paused: false } });
  });

  it('notification content: names, template, voice — and never a private dua name', async () => {
    const itemId = newId();
    const publicId = newPublicId();
    await raw('items').insertOne({
      _id: itemId,
      public_id: publicId,
      masjid_id: ALPHA,
      type: 'dua_request',
      status: 'published',
      audience: 'everyone',
      title: 'Request for Dua',
      body: 'Test dua message.',
      content_locale: 'en',
      is_important: false,
      dua: { category: 'illness', person_name: 'Private Test Name', name_private: true, library_id: newId() },
      voice: { key: `m/${ALPHA.toHexString()}/a/0b7f6c2e-1d4a-4f3b-9c8e-2a1b3c4d5e6f`, duration_s: 12, peaks: [] },
      notify: true,
      masjid_visible: true,
      published_at: NOW,
      published_version: Long.fromNumber(1),
      created_by: newId(),
      created_at: NOW,
      updated_at: NOW,
    });
    const content = await getPushContent(sys(), SYSTEM, itemId);
    expect(content).toMatchObject({
      publicId,
      published: true,
      type: 'dua_request',
      category: 'illness',
      body: 'Test dua message.',
      hasVoice: true,
      template: undefined,
    });
    expect(JSON.stringify(content)).not.toContain('Private Test Name');
    expect(content?.masjidName.length).toBeGreaterThan(0);
    expect(await getPushContent(sys(), SYSTEM, newId())).toBeNull();
  });

  it('no other scope may run the fan-out functions', async () => {
    const admin = adminScope({ adminId: newId(), masjids: [{ id: ALPHA, role: 'owner' }] });
    expect(await code(getFanoutJob(sys(), admin, newId()))).toBe('FORBIDDEN');
    expect(await code(isPushPaused(sys(), deviceScope(newId())))).toBe('FORBIDDEN');
  });
});
