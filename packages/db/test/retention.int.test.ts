// PHASE_08 T8.7 — retention (02 §6) as `mc_system`, one case per rule with clock control (each rule's "just inside"
// document stays, its "just past" one goes), a dry run that counts and changes nothing, small batches that loop, and
// the side rules: a deleted device's follows leave its masjid's follower count, its reports lose the device id; a
// removed admin is anonymized a year after leaving their last masjid; a Ruqyah recording still used by a post is never
// handed out for deletion; closed legal orders hand out their document key. Placeholder text only (10 §Fixtures).
import { createHash, randomBytes } from 'node:crypto';

import type { UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { deviceScope, publicScope, superScope, systemScope } from '../src/scope.ts';
import { buildDevSeed, seedId, seedPublicId, writeDevSeed } from '../src/seed/index.ts';
import {
  addAdminToMasjid,
  createAdmin,
  createReport,
  followMasjid,
  listExpiredLegalOrders,
  listExpiredRuqyah,
  registerDevice,
  removeAdminFromMasjid,
  REMOVED_ADMIN_NAME,
  RETENTION,
  runRetention,
} from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { newId } from '../src/values.ts';

const NOW = new Date('2026-11-13T06:30:00Z');
const TODAY = '2026-11-13';
const ALPHA = seedId('masjid-alpha');
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number, slack = DAY) => new Date(NOW.getTime() - ms - slack); // just past the period
const within = (ms: number, slack = DAY) => new Date(NOW.getTime() - ms + slack); // just inside it
const FAR = new Date(NOW.getTime() + 60 * 60 * 1000); // a deadline that never ends a run in a test

let test: TestDatabase | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asPublic: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asAdmin: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const handle = (h: Awaited<ReturnType<typeof processUserHandle>> | undefined): DbHandle => {
  if (!h) throw new Error('no handle');
  return h.handle;
};
const raw = (name: string) => t().db.collection<{ _id: UUID | string } & Record<string, unknown>>(name);
/** Fixtures for delete-only rules skip the validator (only the retention filter is under test). */
const plant = (name: string, docs: Record<string, unknown>[]) =>
  raw(name).insertMany(
    docs.map((doc) => ({ _id: newId(), ...doc })),
    { bypassDocumentValidation: true },
  );
const newDevice = () =>
  registerDevice(handle(asPublic), publicScope(), {
    secretHash: createHash('sha256').update(randomBytes(32)).digest(),
    locale: 'en',
    audiencePref: 'brothers',
    platform: 'android',
    privacyVersion: 'draft-1',
    now: NOW,
  });
const run = (dryRun: boolean, batch?: number) =>
  runRetention(handle(asSystem), systemScope(), {
    now: NOW,
    dryRun,
    deadline: FAR,
    ...(batch ? { batch } : {}),
  });
const followers = async () => Number((await raw('masjid_stats').findOne({ _id: ALPHA }))?.['followers'] ?? 0);

beforeAll(async () => {
  test = await createTestDatabase('retention-state');
  await runMigrations(t().db, MIGRATIONS);
  asSystem = await processUserHandle(t(), 'mc_system');
  asPublic = await processUserHandle(t(), 'mc_public');
  asAdmin = await processUserHandle(t(), 'mc_admin');
  await writeDevSeed(asSystem.handle, systemScope(), buildDevSeed({ now: NOW, today: TODAY }));
});

afterAll(async () => {
  await asSystem?.dispose();
  await asPublic?.dispose();
  await asAdmin?.dispose();
  await test?.dispose();
});

describe('retention (T8.7)', () => {
  let oldDevice: UUID;
  let youngDevice: UUID;
  let followersBefore = 0;
  let removedAdmin: UUID;
  let recentlyRemoved: UUID;
  let reportId: UUID;

  beforeAll(async () => {
    // Devices: one unused for 181 days (following Alpha, with a report), one for 179 days with a dead push address.
    oldDevice = await newDevice();
    youngDevice = await newDevice();
    await followMasjid(handle(asPublic), deviceScope(oldDevice), ALPHA);
    followersBefore = await followers();
    reportId = await createReport(handle(asPublic), deviceScope(oldDevice), {
      target: { kind: 'item', publicId: seedPublicId('alpha', 0) },
      reason: 'misleading',
      urgent: false,
      slaDueAt: new Date(NOW.getTime() + DAY),
      now: NOW,
    });
    await raw('devices').updateOne({ _id: oldDevice }, { $set: { last_seen_at: ago(RETENTION.inactiveDeviceMs) } });
    await raw('devices').updateOne(
      { _id: youngDevice },
      {
        $set: {
          last_seen_at: within(RETENTION.inactiveDeviceMs),
          push_status: 'dead',
          push_endpoint: 'https://push.example.invalid/test',
          push_p256dh: 'test-key',
          push_auth: 'test-auth',
          push_updated_at: ago(RETENTION.deadPushMs),
        },
      },
    );

    // Delete-only rules: one just past and one just inside each period.
    await plant('admin_sessions', [
      { admin_id: newId(), token_hash: randomBytes(32), revoked_at: ago(RETENTION.adminSessionMs), mark: 'old' },
      {
        admin_id: newId(),
        token_hash: randomBytes(32),
        absolute_expires_at: ago(RETENTION.adminSessionMs),
        mark: 'old',
      },
      { admin_id: newId(), token_hash: randomBytes(32), revoked_at: within(RETENTION.adminSessionMs), mark: 'keep' },
    ]);
    await plant('admin_invites', [
      { admin_id: newId(), token_hash: randomBytes(32), used_at: ago(RETENTION.adminInviteMs), mark: 'old' },
      { admin_id: newId(), token_hash: randomBytes(32), expires_at: within(RETENTION.adminInviteMs), mark: 'keep' },
    ]);
    await plant('reports', [
      { status: 'dismissed', closed_at: ago(RETENTION.reportMs), mark: 'old' },
      { status: 'actioned', closed_at: within(RETENTION.reportMs), mark: 'keep' },
    ]);
    await plant('grievances', [
      { public_ref: 'GR-2023-000001', status: 'resolved', resolved_at: ago(RETENTION.grievanceMs), mark: 'old' },
      { public_ref: 'GR-2023-000002', status: 'rejected', resolved_at: within(RETENTION.grievanceMs), mark: 'keep' },
      { public_ref: 'GR-2023-000003', status: 'acknowledged', created_at: ago(RETENTION.grievanceMs), mark: 'keep' },
    ]);
    await plant('audit_log', [
      { at: ago(RETENTION.auditMs), action: 'test.old', mark: 'old' },
      { at: within(RETENTION.auditMs), action: 'test.keep', mark: 'keep' },
    ]);
    await plant('notification_jobs', [
      { created_at: ago(RETENTION.notificationJobMs), mark: 'old' },
      { created_at: within(RETENTION.notificationJobMs), mark: 'keep' },
    ]);
    await plant('push_quota_usage', [
      { masjid_id: ALPHA, day: '2026-08-01', count: 1, mark: 'old' }, // 104 days before
      { masjid_id: ALPHA, day: '2026-09-01', count: 1, mark: 'keep' }, // 73 days before
    ]);
    await plant('stats_snapshots', [
      { created_at: ago(RETENTION.statsMs), mark: 'old' },
      { created_at: within(RETENTION.statsMs), mark: 'keep' },
    ]);
    await plant('masjid_contacts', [
      { masjid_id: ALPHA, status: 'deleted', deleted_at: ago(RETENTION.deletedSectionMs), mark: 'old' },
      { masjid_id: ALPHA, status: 'deleted', deleted_at: within(RETENTION.deletedSectionMs), mark: 'keep' },
      { masjid_id: ALPHA, status: 'active', mark: 'keep' },
    ]);
    // Campaign amount history: a campaign that ended a year ago, and one that ended recently.
    const ended = newId();
    const recent = newId();
    await raw('items').insertMany(
      [
        {
          _id: ended,
          public_id: 'retentionAAA',
          type: 'campaign',
          campaign: { status: 'completed' },
          updated_at: ago(RETENTION.campaignHistoryMs),
        },
        {
          _id: recent,
          public_id: 'retentionBBB',
          type: 'campaign',
          campaign: { status: 'closed' },
          updated_at: within(RETENTION.campaignHistoryMs),
        },
      ],
      { bypassDocumentValidation: true },
    );
    await plant('campaign_amount_history', [
      { campaign_item_id: ended, mark: 'old' },
      { campaign_item_id: ended, mark: 'old' },
      { campaign_item_id: recent, mark: 'keep' },
    ]);

    // Admins: one removed from their last masjid 366 days ago, one 300 days ago.
    const superAdmin = superScope(newId(), NOW);
    removedAdmin = await createAdmin(handle(asAdmin), superAdmin, { displayName: 'Test Admin One', uiLocale: 'en' });
    recentlyRemoved = await createAdmin(handle(asAdmin), superAdmin, { displayName: 'Test Admin Two', uiLocale: 'en' });
    await addAdminToMasjid(handle(asAdmin), superAdmin, { masjidId: ALPHA, adminId: removedAdmin, role: 'editor' });
    await removeAdminFromMasjid(handle(asAdmin), superAdmin, { masjidId: ALPHA, adminId: removedAdmin, now: NOW });
    await raw('admin_users').updateOne(
      { _id: removedAdmin },
      {
        $set: {
          removed_at: ago(RETENTION.removedAdminMs),
          phone_enc: 'v1:k1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAA',
        },
      },
    );
    await raw('admin_users').updateOne(
      { _id: recentlyRemoved },
      { $set: { removed_at: within(RETENTION.removedAdminMs) } },
    );
    await plant('webauthn_credentials', [
      { admin_id: removedAdmin, credential_id: randomBytes(16) },
      { admin_id: recentlyRemoved, credential_id: randomBytes(16) },
    ]);
  });

  it('leaving the last masjid marks the admin removed; being added back clears it', async () => {
    const superAdmin = superScope(newId(), NOW);
    const admin = await createAdmin(handle(asAdmin), superAdmin, { displayName: 'Test Admin Three', uiLocale: 'en' });
    await addAdminToMasjid(handle(asAdmin), superAdmin, { masjidId: ALPHA, adminId: admin, role: 'editor' });
    expect((await raw('admin_users').findOne({ _id: admin }))?.['removed_at']).toBeUndefined();
    await removeAdminFromMasjid(handle(asAdmin), superAdmin, { masjidId: ALPHA, adminId: admin, now: NOW });
    expect((await raw('admin_users').findOne({ _id: admin }))?.['removed_at']).toEqual(NOW);
    await addAdminToMasjid(handle(asAdmin), superAdmin, { masjidId: ALPHA, adminId: admin, role: 'editor' });
    expect((await raw('admin_users').findOne({ _id: admin }))?.['removed_at']).toBeUndefined();
  });

  it('a dry run counts what is due and changes nothing', async () => {
    const before = await raw('admin_sessions').countDocuments();
    const counts = await run(true);
    expect(counts).toMatchObject({
      devices: 1,
      deadPush: 1,
      adminSessions: 2,
      adminInvites: 1,
      reports: 1,
      grievances: 1,
      audit: 1,
      notificationJobs: 1,
      pushQuota: 1,
      campaignHistory: 2,
      removedAdmins: 1,
      stats: 1,
      contacts: 1,
    });
    expect(await raw('admin_sessions').countDocuments()).toBe(before);
    expect(await raw('devices').countDocuments({ _id: oldDevice })).toBe(1);
    expect((await raw('admin_users').findOne({ _id: removedAdmin }))?.['display_name']).toBe('Test Admin One');
  });

  it('a run deletes exactly what is due (small batches loop), and a second run finds nothing', async () => {
    const counts = await run(false, 1);
    expect(counts).toMatchObject({
      devices: 1,
      reportDevices: 1,
      deadPush: 1,
      adminSessions: 2,
      adminInvites: 1,
      reports: 1,
      grievances: 1,
      audit: 1,
      notificationJobs: 1,
      pushQuota: 1,
      campaignHistory: 2,
      removedAdmins: 1,
      stats: 1,
      contacts: 1,
    });
    for (const name of [
      'admin_sessions',
      'admin_invites',
      'reports',
      'grievances',
      'audit_log',
      'notification_jobs',
      'push_quota_usage',
      'stats_snapshots',
      'masjid_contacts',
      'campaign_amount_history',
    ]) {
      expect(await raw(name).countDocuments({ mark: 'old' }), name).toBe(0);
      expect(await raw(name).countDocuments({ mark: 'keep' }), name).toBeGreaterThan(0);
    }
    // The device, its follow (the masjid's count goes down) — and its report stays, without the device id.
    expect(await raw('devices').countDocuments({ _id: oldDevice })).toBe(0);
    expect(await raw('device_follows').countDocuments({ device_id: oldDevice })).toBe(0);
    expect(await followers()).toBe(followersBefore - 1);
    const report = await raw('reports').findOne({ _id: reportId });
    expect(report).not.toBeNull();
    expect(report?.['device_id']).toBeUndefined();
    // The young device stays; only its dead push address goes.
    const young = await raw('devices').findOne({ _id: youngDevice });
    expect(young).toMatchObject({ push_status: 'none' });
    expect(young?.['push_endpoint']).toBeUndefined();
    expect(young?.['push_auth']).toBeUndefined();
    // The removed admin is anonymized (the record stays for the audit trail); the recent one is untouched.
    const anonymized = await raw('admin_users').findOne({ _id: removedAdmin });
    expect(anonymized).toMatchObject({ display_name: REMOVED_ADMIN_NAME, status: 'disabled' });
    expect(anonymized?.['phone_enc']).toBeUndefined();
    expect(await raw('webauthn_credentials').countDocuments({ admin_id: removedAdmin })).toBe(0);
    expect((await raw('admin_users').findOne({ _id: recentlyRemoved }))?.['display_name']).toBe('Test Admin Two');
    expect(await raw('webauthn_credentials').countDocuments({ admin_id: recentlyRemoved })).toBe(1);

    const again = await run(false);
    expect(Object.values(again).every((value) => value === 0)).toBe(true);
  });

  it('Ruqyah: deleted entries 30 days on, with the recording only when nothing else uses it', async () => {
    const shared = `m/${ALPHA.toHexString(true)}/a/${newId().toHexString(true)}`;
    const own = `m/${ALPHA.toHexString(true)}/a/${newId().toHexString(true)}`;
    await plant('ruqyah_entries', [
      { status: 'deleted', deleted_at: ago(RETENTION.deletedSectionMs), audio: { key: own }, mark: 'own' },
      { status: 'deleted', deleted_at: ago(RETENTION.deletedSectionMs), audio: { key: shared }, mark: 'shared' },
      { status: 'deleted', deleted_at: within(RETENTION.deletedSectionMs), mark: 'young' },
    ]);
    await plant('items', [{ public_id: 'retentionCCC', type: 'announcement', voice: { key: shared } }]);
    const due = await listExpiredRuqyah(handle(asSystem), systemScope(), { now: NOW });
    expect(due).toHaveLength(2);
    expect(due.map((entry) => entry.audioKey).sort()).toEqual([own, undefined].sort());
  });

  it('legal orders: closed 3 years ago, with their document key; open ones never', async () => {
    await plant('legal_orders', [
      { status: 'closed', updated_at: ago(RETENTION.legalOrderMs), document_key: 'legal/x/y.bin' },
      { status: 'closed', updated_at: within(RETENTION.legalOrderMs) },
      { status: 'contested', updated_at: ago(RETENTION.legalOrderMs) },
    ]);
    const due = await listExpiredLegalOrders(handle(asSystem), systemScope(), { now: NOW });
    expect(due).toEqual([expect.objectContaining({ documentKey: 'legal/x/y.bin' })]);
  });

  it('only the system scope runs retention', async () => {
    await expect(
      runRetention(handle(asAdmin), superScope(newId(), NOW), { now: NOW, dryRun: true, deadline: FAR }),
    ).rejects.toThrow(/FORBIDDEN/u);
  });
});
