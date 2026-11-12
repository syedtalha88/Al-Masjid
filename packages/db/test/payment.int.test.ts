// PHASE_05 T5.2 — the UPI change-lock (04 R1, 02 payment_profiles) as the real `mc_admin` / `mc_system` / `mc_public`
// users: an admin only *requests* (one open request per masjid, also under concurrency); the Super Admin approves with
// a fresh step-up (→ on hold until `effective_at`) or rejects — also during the hold (DECISIONS #146); only the
// system job activates, at `effective_at`, superseding the previous profile, bumping the version and publishing the
// locked "Payment details updated" notice with a quota-free push. There is no other write path. Fake VPAs only.
import { randomBytes } from 'node:crypto';

import { Binary, type Long, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { PolicyDeniedError } from '../src/policy.ts';
import { getAdminPayment, getMasjidBundle, listOpenPayments } from '../src/repos/index.ts';
import { adminScope, superScope, systemScope } from '../src/scope.ts';
import { scoped } from '../src/scoped.ts';
import { buildDevSeed, seedId, writeDevSeed } from '../src/seed/index.ts';
import {
  activateDuePaymentProfiles,
  approvePaymentChange,
  createAdminForMasjid,
  deleteItem,
  editItem,
  PAYMENT_NOTICE_TEMPLATE,
  rejectPaymentChange,
  removeAdminFromMasjid,
  requestPaymentChange,
  revokeAdminSessions,
  revokeSessions,
} from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { idText, newId, parseId } from '../src/values.ts';

const NOW = new Date('2026-11-10T06:30:00Z');
const TODAY = '2026-11-10';
const HOLD = 1440;
const MINUTE = 60_000;
const ALPHA = seedId('masjid-alpha');
const BETA = seedId('masjid-beta');
const GAMMA = seedId('masjid-gamma');

let test: TestDatabase | undefined;
const handles: Partial<Record<'admin' | 'public' | 'system', Awaited<ReturnType<typeof processUserHandle>>>> = {};
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const as = (user: 'admin' | 'public' | 'system'): DbHandle => {
  const entry = handles[user];
  if (!entry) throw new Error(`no ${user} handle`);
  return entry.handle;
};
const raw = (name: string) => t().db.collection<{ _id: UUID } & Record<string, unknown>>(name);
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof StateError) return error.code;
    if (error instanceof PolicyDeniedError) return 'POLICY_DENIED';
    throw error;
  }
};
/** One real, active owner per test masjid (approval and activation check the requester again — #161 L1). */
const owners = new Map<string, ReturnType<typeof adminScope>>();
const adminOf = (masjid: UUID) => {
  const owner = owners.get(idText(masjid));
  if (!owner) throw new Error('no owner for this masjid');
  return owner;
};
const SUPER = newId();
const fresh = (at = NOW) => superScope(SUPER, new Date(at.getTime() - MINUTE));
const version = async (id: UUID) =>
  ((await raw('masjids').findOne({ _id: id }, { promoteLongs: false }))?.['content_version'] as Long).toNumber(); // int64
const idOf = (text: string) => {
  const id = parseId(text);
  if (!id) throw new Error(`not an id: ${text}`);
  return id;
};
const request = (masjid: UUID, vpa = 'masjid.test@okbank', admin = adminOf(masjid), at = NOW) =>
  requestPaymentChange(as('admin'), admin, {
    masjidId: masjid,
    vpa,
    payeeName: 'Test Masjid Committee',
    note: 'New committee account',
    requestId: 'req-pay-1',
    now: at,
  });
const approve = (id: string, at = NOW) =>
  approvePaymentChange(as('admin'), fresh(at), { profileId: idOf(id), holdMinutes: HOLD, now: at });
const ownersOf = async (masjid: UUID) =>
  (await raw('masjid_admins').find({ masjid_id: masjid, role: 'owner' }).toArray()).map((row) => row['admin_id']);
const run = (at: Date) => activateDuePaymentProfiles(as('system'), systemScope(), { now: at });
const activate = async (at: Date) => (await run(at)).activated;

beforeAll(async () => {
  test = await createTestDatabase('payment-state');
  await runMigrations(t().db, MIGRATIONS);
  handles.admin = await processUserHandle(t(), 'mc_admin');
  handles.public = await processUserHandle(t(), 'mc_public');
  handles.system = await processUserHandle(t(), 'mc_system');
  await writeDevSeed(as('system'), systemScope(), buildDevSeed({ now: NOW, today: TODAY }));
  for (const masjid of [ALPHA, BETA, GAMMA]) owners.set(idText(masjid), await member(masjid, 'owner'));
});

/** A real, active admin with a membership (the seed has none), through the Super Admin's own state function. */
async function member(masjid: UUID, role: 'owner' | 'editor') {
  const { adminId } = await createAdminForMasjid(as('admin'), superScope(SUPER), {
    displayName: `Test ${role}`,
    uiLocale: 'en',
    masjidId: masjid,
    role,
    inviteTokenHash: randomBytes(32),
    now: NOW,
  });
  await raw('admin_users').updateOne({ _id: adminId }, { $set: { status: 'active' } }); // as after registration
  return adminScope({ adminId, masjids: [{ id: masjid, role }] });
}

afterAll(async () => {
  for (const entry of Object.values(handles)) await entry.dispose();
  await test?.dispose();
});

describe('requestPaymentChange (admin)', () => {
  it('creates a pending, open request — not public, no version bump, audited without the VPA', async () => {
    const before = await version(GAMMA);
    const admin = adminOf(GAMMA);
    const { id } = await request(GAMMA, '  Masjid.Gamma@OKBank ', admin);
    expect(await raw('payment_profiles').findOne({ _id: idOf(id) })).toMatchObject({
      masjid_id: GAMMA,
      vpa: 'Masjid.Gamma@okbank', // normalized
      payee_name: 'Test Masjid Committee',
      request_note: 'New committee account',
      status: 'pending',
      open: true,
      requested_by: admin.adminId,
      masjid_visible: true,
    });
    expect(await version(GAMMA)).toBe(before);
    const bundle = await getMasjidBundle(as('public'), GAMMA, TODAY);
    expect(bundle?.status === 'active' ? bundle.payment : 'not active').toBeNull();
    const audit = await raw('audit_log').findOne({ action: 'payment.request', target_id: id });
    expect(audit).toMatchObject({ masjid_id: GAMMA, actor_id: admin.adminId, request_id: 'req-pay-1' });
    expect(JSON.stringify(audit)).not.toMatch(/okbank|Committee/);
  });

  it('one open request per masjid — also when five arrive at once', async () => {
    expect(await code(request(GAMMA, 'other.vpa@okbank'))).toBe('PAYMENT_REQUEST_OPEN');
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => code(request(BETA, `beta.vpa${String(n)}@okbank`))));
    expect(results.filter((result) => result === 'ok')).toHaveLength(1);
    expect(results.filter((result) => result === 'PAYMENT_REQUEST_OPEN')).toHaveLength(4);
    expect(await raw('payment_profiles').countDocuments({ masjid_id: BETA, open: true })).toBe(1);
  });

  it('refuses invalid input, other masjids, the Super Admin and the system', async () => {
    const masjid = ALPHA;
    const call = (input: Partial<{ vpa: string; payeeName: string; note: string }>) =>
      code(
        requestPaymentChange(as('admin'), adminOf(masjid), {
          masjidId: masjid,
          vpa: 'alpha.vpa@okbank',
          payeeName: 'Test Masjid Committee',
          ...input,
          now: NOW,
        }),
      );
    expect(await call({ vpa: 'not a vpa' })).toBe('PAYMENT_INVALID');
    expect(await call({ vpa: 'alpha@okbank&am=1' })).toBe('PAYMENT_INVALID');
    expect(await call({ payeeName: ' \n ' })).toBe('PAYMENT_INVALID');
    expect(await call({ payeeName: 'x'.repeat(101) })).toBe('PAYMENT_INVALID');
    expect(await call({ note: 'x'.repeat(301) })).toBe('PAYMENT_INVALID');
    expect(await code(request(ALPHA, 'alpha.vpa@okbank', adminOf(BETA)))).toBe('MASJID_NOT_FOUND');
    expect(
      await code(
        requestPaymentChange(as('admin'), fresh(), { masjidId: ALPHA, vpa: 'a.vpa@okbank', payeeName: 'X', now: NOW }),
      ),
    ).toBe('MASJID_NOT_FOUND');
    expect(
      await code(
        requestPaymentChange(as('system'), systemScope(), {
          masjidId: ALPHA,
          vpa: 'a.vpa@okbank',
          payeeName: 'X',
          now: NOW,
        }),
      ),
    ).toBe('MASJID_NOT_FOUND');
    expect(await raw('payment_profiles').countDocuments({ masjid_id: ALPHA })).toBe(0);
  });

  it('there is no other write path: the policy layer refuses every generic payment_profiles write', async () => {
    const admin = adminOf(ALPHA);
    const doc = { _id: newId(), masjid_id: ALPHA, vpa: 'evil.vpa@okbank', payee_name: 'X', status: 'active' };
    expect(await code(scoped({ scope: admin, db: t().db }, 'payment_profiles').insertOne(doc))).toBe('POLICY_DENIED');
    expect(
      await code(
        scoped({ scope: admin, db: t().db }, 'payment_profiles').updateMany({}, { $set: { vpa: 'evil.vpa@okbank' } }),
      ),
    ).toBe('POLICY_DENIED');
    expect(
      await code(
        scoped({ scope: fresh(), db: t().db }, 'payment_profiles').updateMany({}, { $set: { status: 'active' } }),
      ),
    ).toBe('POLICY_DENIED');
    expect(await code(scoped({ scope: fresh(), db: t().db }, 'payment_profiles').insertOne(doc))).toBe('POLICY_DENIED');
  });
});

describe('approve / reject (Super Admin)', () => {
  it('approve needs the Super Admin with a fresh step-up', async () => {
    const pending = await raw('payment_profiles').findOne({ masjid_id: BETA, open: true });
    const id = idText(pending?._id ?? newId());
    const profileId = idOf(id);
    const call = (scope: Parameters<typeof approvePaymentChange>[1]) =>
      code(approvePaymentChange(as('admin'), scope, { profileId, holdMinutes: HOLD, now: NOW }));
    expect(await call(adminOf(BETA))).toBe('FORBIDDEN');
    expect(await call(superScope(SUPER))).toBe('STEP_UP_REQUIRED');
    expect(await call(superScope(SUPER, new Date(NOW.getTime() - 6 * MINUTE)))).toBe('STEP_UP_REQUIRED');
    expect(await call(systemScope())).toBe('FORBIDDEN');
    expect((await raw('payment_profiles').findOne({ _id: profileId }))?.['status']).toBe('pending');
  });

  it('approve puts the request on hold until now + hold; a second approve is refused', async () => {
    const pending = await raw('payment_profiles').findOne({ masjid_id: GAMMA, open: true });
    const id = idText(pending?._id ?? newId());
    const result = await approve(id);
    expect(result).toEqual({
      masjidId: GAMMA,
      requestedBy: pending?.['requested_by'],
      ownerIds: await ownersOf(GAMMA),
      effectiveAt: new Date(NOW.getTime() + HOLD * MINUTE),
    });
    expect(await raw('payment_profiles').findOne({ _id: idOf(id) })).toMatchObject({
      status: 'approved_on_hold',
      open: true,
      reviewed_by: SUPER,
      reviewed_at: NOW,
      effective_at: new Date(NOW.getTime() + HOLD * MINUTE),
    });
    expect(await code(approve(id))).toBe('PAYMENT_NOT_PENDING');
    expect(await raw('audit_log').findOne({ action: 'payment.approve', target_id: id })).toMatchObject({
      actor_id: SUPER,
      masjid_id: GAMMA,
      meta: { hold_minutes: HOLD },
    });
  });

  it('reject closes a pending request with a reason; the masjid may request again', async () => {
    const pending = await raw('payment_profiles').findOne({ masjid_id: BETA, open: true });
    const id = idText(pending?._id ?? newId());
    expect(
      await code(rejectPaymentChange(as('admin'), adminOf(BETA), { profileId: idOf(id), reason: 'x', now: NOW })),
    ).toBe('FORBIDDEN');
    expect(await code(rejectPaymentChange(as('admin'), fresh(), { profileId: idOf(id), reason: '  ', now: NOW }))).toBe(
      'PAYMENT_INVALID',
    );
    const result = await rejectPaymentChange(as('admin'), superScope(SUPER), {
      profileId: idOf(id),
      reason: 'Payee name does not match the committee account',
      now: NOW,
    });
    expect(result).toEqual({ masjidId: BETA, requestedBy: pending?.['requested_by'], ownerIds: await ownersOf(BETA) });
    expect(await raw('payment_profiles').findOne({ _id: idOf(id) })).toMatchObject({
      status: 'rejected',
      open: false,
      reject_reason: 'Payee name does not match the committee account',
      reviewed_by: SUPER,
    });
    expect(await code(rejectPaymentChange(as('admin'), fresh(), { profileId: idOf(id), reason: 'x', now: NOW }))).toBe(
      'PAYMENT_NOT_OPEN',
    );
    expect(await code(request(BETA, 'beta.again@okbank'))).toBe('ok');
  });
});

describe('activation (system job)', () => {
  it('only the system activates; nothing happens before effective_at', async () => {
    expect(
      await code(
        activateDuePaymentProfiles(as('admin'), adminOf(GAMMA), { now: new Date(NOW.getTime() + 2 * HOLD * MINUTE) }),
      ),
    ).toBe('FORBIDDEN');
    expect(await activate(new Date(NOW.getTime() + (HOLD - 1) * MINUTE))).toEqual([]);
    expect(await raw('payment_profiles').countDocuments({ masjid_id: GAMMA, status: 'active' })).toBe(0);
  });

  it('at effective_at: active, public, version bumped, a locked important notice with a quota-free push', async () => {
    const before = await version(GAMMA);
    const at = new Date(NOW.getTime() + HOLD * MINUTE);
    const activated = await activate(at);
    expect(activated).toHaveLength(1);
    const [first] = activated;
    expect(first).toMatchObject({ masjidId: GAMMA });
    expect(await version(GAMMA)).toBe(before + 1);
    const profile = await raw('payment_profiles').findOne({ masjid_id: GAMMA, status: 'active' });
    expect(profile).toMatchObject({ vpa: 'Masjid.Gamma@okbank', open: false });
    const bundle = await getMasjidBundle(as('public'), GAMMA, TODAY);
    expect(bundle?.status === 'active' ? bundle.payment : null).toEqual({
      vpa: 'Masjid.Gamma@okbank',
      payeeName: 'Test Masjid Committee',
      effectiveAt: at.toISOString(),
    });
    const notice = await raw('items').findOne({ masjid_id: GAMMA, template_key: PAYMENT_NOTICE_TEMPLATE });
    expect(notice).toMatchObject({
      type: 'announcement',
      status: 'published',
      audience: 'everyone',
      is_important: true,
      notify: true,
      announcement: { category: 'general' },
    });
    expect(first?.noticeJobId).toBeDefined();
    expect(await raw('notification_jobs').findOne({ item_id: notice?._id })).toMatchObject({
      bypass_quota: true,
      status: 'pending',
    });
    expect(await raw('audit_log').findOne({ action: 'payment.activate', masjid_id: GAMMA })).toMatchObject({
      actor_type: 'system',
    });
    // Idempotent: a second run finds nothing.
    expect(await activate(new Date(at.getTime() + MINUTE))).toEqual([]);
  });

  it('a later change supersedes the active profile; one active per masjid holds in the database', async () => {
    const { id } = await request(GAMMA, 'gamma.second@okbank');
    const later = new Date(NOW.getTime() + 2 * HOLD * MINUTE);
    await approve(id, later);
    // During the hold the old details stay public.
    const during = await getMasjidBundle(as('public'), GAMMA, TODAY);
    expect(during?.status === 'active' ? during.payment?.vpa : null).toBe('Masjid.Gamma@okbank');
    await activate(new Date(later.getTime() + HOLD * MINUTE));
    const statuses = await raw('payment_profiles')
      .find({ masjid_id: GAMMA }, { sort: { created_at: 1 } })
      .map((doc) => doc['status'])
      .toArray();
    expect(statuses).toEqual(['superseded', 'active']);
    const after = await getMasjidBundle(as('public'), GAMMA, TODAY);
    expect(after?.status === 'active' ? after.payment?.vpa : null).toBe('gamma.second@okbank');
    // The partial unique index: a second active profile for the masjid cannot exist.
    await expect(
      raw('payment_profiles').insertOne({
        _id: new UUID(),
        masjid_id: GAMMA,
        vpa: 'evil.vpa@okbank',
        payee_name: 'X',
        status: 'active',
        open: false,
        requested_by: newId(),
        masjid_visible: true,
        created_at: NOW,
        updated_at: NOW,
      }),
    ).rejects.toThrow(/duplicate key/);
  });

  it('the Super Admin can stop a change during the hold (reject from approved_on_hold)', async () => {
    const { id } = await request(GAMMA, 'gamma.stolen@okbank');
    await approve(id, new Date(NOW.getTime() + 4 * HOLD * MINUTE));
    await rejectPaymentChange(as('admin'), superScope(SUPER), {
      profileId: idOf(id),
      reason: 'Committee did not ask for this',
      now: new Date(NOW.getTime() + 4 * HOLD * MINUTE + MINUTE),
    });
    expect(await activate(new Date(NOW.getTime() + 6 * HOLD * MINUTE))).toEqual([]);
    const bundle = await getMasjidBundle(as('public'), GAMMA, TODAY);
    expect(bundle?.status === 'active' ? bundle.payment?.vpa : null).toBe('gamma.second@okbank');
  });

  it('the "Payment details updated" notice cannot be edited or deleted by the masjid', async () => {
    const notice = await raw('items').findOne({ masjid_id: GAMMA, template_key: PAYMENT_NOTICE_TEMPLATE });
    if (!notice) throw new Error('no notice');
    const admin = adminOf(GAMMA);
    expect(await code(deleteItem(as('admin'), admin, { masjidId: GAMMA, itemId: notice._id, now: NOW }))).toBe(
      'ITEM_LOCKED',
    );
    expect(
      await code(
        editItem(as('admin'), admin, {
          masjidId: GAMMA,
          itemId: notice._id,
          ifMatch: (notice['updated_at'] as Date).toISOString(), // a Date by schema
          edit: {
            type: 'announcement',
            announcement: {
              content: { kind: 'text', title: 'Pay here instead', body: 'evil.vpa@okbank', locale: 'en' },
              category: 'general',
              isImportant: false,
            },
          },
          now: NOW,
        }),
      ),
    ).toBe('ITEM_LOCKED');
    expect((await raw('items').findOne({ _id: notice._id }))?.['status']).toBe('published');
  });
});

describe('reads (B8 status, C4 queue)', () => {
  it('the admin sees the live details and the open request; a later rejection stays visible until a new request', async () => {
    const admin = adminOf(GAMMA);
    const later = new Date(NOW.getTime() + 8 * HOLD * MINUTE); // after the second profile went live
    const { id } = await request(GAMMA, 'gamma.third@okbank', admin, later);
    const open = await getAdminPayment(as('admin'), admin, GAMMA);
    expect(open.active).toMatchObject({ vpa: 'gamma.second@okbank', payeeName: 'Test Masjid Committee' });
    expect(open.request).toMatchObject({
      id,
      status: 'pending',
      vpa: 'gamma.third@okbank',
      note: 'New committee account',
    });
    await rejectPaymentChange(as('admin'), superScope(SUPER), {
      profileId: idOf(id),
      reason: 'Wrong account',
      now: later,
    });
    const rejected = await getAdminPayment(as('admin'), admin, GAMMA);
    expect(rejected.request).toMatchObject({ id, status: 'rejected', rejectReason: 'Wrong account' });
    expect(await code(getAdminPayment(as('admin'), adminOf(BETA), GAMMA))).toBe('MASJID_NOT_FOUND');
  });

  it('the Super Admin queue lists open requests with masjid, requester and the live details; nobody else reads it', async () => {
    const { requests } = await listOpenPayments(as('admin'), superScope(SUPER));
    const beta = requests.find((row) => row.masjid.id === idText(BETA));
    expect(beta).toMatchObject({
      status: 'pending',
      vpa: 'beta.again@okbank',
      masjid: { name: expect.any(String) as string },
      current: null,
    });
    // 07 C4 history: Beta's request refused earlier in this file is shown with the new one.
    expect(beta?.history).toEqual([expect.objectContaining({ status: 'rejected', vpa: expect.any(String) as string })]);
    expect(requests.every((row) => row.history.length <= 5)).toBe(true);
    expect(requests.every((row) => row.status === 'pending' || row.status === 'approved_on_hold')).toBe(true);
    expect(await code(listOpenPayments(as('admin'), adminOf(BETA)))).toBe('FORBIDDEN');
  });
});

describe('followers are always told (DECISIONS #160, security review M1 + L1)', () => {
  const template = () => t().db.collection<{ _id: string }>('notice_templates'); // string ids
  const setTemplate = (status: 'active' | 'draft' | 'retired') =>
    template().updateOne({ _id: PAYMENT_NOTICE_TEMPLATE }, { $set: { status } });
  const setMasjid = (status: 'active' | 'suspended') => raw('masjids').updateOne({ _id: BETA }, { $set: { status } });

  it('approval is refused while the "Payment details updated" template is not active', async () => {
    const pending = await raw('payment_profiles').findOne({ masjid_id: BETA, open: true });
    if (!pending) throw new Error('no open request on Beta');
    const at = new Date(NOW.getTime() + 10 * HOLD * MINUTE);
    await setTemplate('draft');
    try {
      expect(await code(approve(pending._id.toString(), at))).toBe('PAYMENT_NOTICE_UNAVAILABLE');
      expect((await raw('payment_profiles').findOne({ _id: pending._id }))?.['status']).toBe('pending');
    } finally {
      await setTemplate('active');
    }
    await approve(pending._id.toString(), at);
    expect((await raw('payment_profiles').findOne({ _id: pending._id }))?.['status']).toBe('approved_on_hold');
  });

  it('due but the masjid is suspended, or the template was retired: held back, live with the notice on a later run', async () => {
    const onHold = await raw('payment_profiles').findOne({ masjid_id: BETA, status: 'approved_on_hold' });
    if (!onHold) throw new Error('no approved request on Beta');
    const due = new Date(NOW.getTime() + 12 * HOLD * MINUTE);
    const status = async () => (await raw('payment_profiles').findOne({ _id: onHold._id }))?.['status'];
    const notices = () => raw('items').countDocuments({ masjid_id: BETA, template_key: PAYMENT_NOTICE_TEMPLATE });

    await setMasjid('suspended');
    try {
      expect((await run(due)).heldBack.map((id) => id.toString())).toEqual([onHold._id.toString()]);
      expect(await status()).toBe('approved_on_hold');
    } finally {
      await setMasjid('active');
    }
    await setTemplate('retired');
    try {
      expect((await run(due)).heldBack).toHaveLength(1);
      expect(await status()).toBe('approved_on_hold');
      expect(await notices()).toBe(0);
    } finally {
      await setTemplate('active');
    }
    const live = await run(due);
    expect(live).toMatchObject({ heldBack: [], activated: [{ masjidId: BETA, ownerIds: await ownersOf(BETA) }] });
    expect(await status()).toBe('active');
    expect(await notices()).toBe(1);
  });
});

describe('owners only; a request closes with its admin (DECISIONS #161 — F69, security review L2 + L3)', () => {
  const closeOpen = (masjid: UUID) =>
    raw('payment_profiles').updateMany(
      { masjid_id: masjid, open: true },
      { $set: { open: false, status: 'rejected', updated_at: NOW } },
    );
  /** A session row for `adminId` (what a passkey sign-in creates). */
  const sessionFor = async (adminId: UUID) => {
    const id = newId();
    await raw('admin_sessions').insertOne({
      _id: id,
      admin_id: adminId,
      token_hash: new Binary(randomBytes(32)),
      created_at: NOW,
      last_seen_at: NOW,
      idle_expires_at: new Date(NOW.getTime() + HOLD * MINUTE),
      absolute_expires_at: new Date(NOW.getTime() + 30 * HOLD * MINUTE),
    });
    return id;
  };
  const statusOf = async (id: string) => (await raw('payment_profiles').findOne({ _id: idOf(id) }))?.['status'];

  it('an editor cannot ask; an owner can, and every owner (the requester too) is named for the alert', async () => {
    await closeOpen(ALPHA);
    const editor = await member(ALPHA, 'editor');
    expect(await code(request(ALPHA, 'editor.try@okbank', editor))).toBe('PAYMENT_OWNER_ONLY');
    expect(await raw('payment_profiles').countDocuments({ masjid_id: ALPHA, open: true })).toBe(0);
    const owner = await member(ALPHA, 'owner');
    const created = await request(ALPHA, 'owner.asks@okbank', owner);
    expect(created.ownerIds).toEqual(await ownersOf(ALPHA));
    expect(created.ownerIds).toContainEqual(owner.adminId);
    expect(created.ownerIds).not.toContainEqual(editor.adminId);
    // Removing the requester from the masjid closes their request in the same transaction, with the caller's id.
    await removeAdminFromMasjid(as('admin'), fresh(), {
      masjidId: ALPHA,
      adminId: owner.adminId,
      requestId: 'req-remove-1',
      now: NOW,
    });
    expect(await raw('payment_profiles').findOne({ _id: idOf(created.id) })).toMatchObject({
      status: 'rejected',
      open: false,
      reject_code: 'requester_removed',
    });
    expect(await raw('audit_log').findOne({ action: 'payment.reject', target_id: created.id })).toMatchObject({
      masjid_id: ALPHA,
      request_id: 'req-remove-1',
      meta: { from: 'pending', code: 'requester_removed' },
    });
    const b8 = await getAdminPayment(as('admin'), adminOf(ALPHA), ALPHA);
    expect(b8.request).toMatchObject({ id: created.id, status: 'rejected', rejectCode: 'requester_removed' });
  });

  it('revoking the requester’s sessions stops a change even during the hold — it never goes live', async () => {
    await closeOpen(ALPHA);
    const owner = await member(ALPHA, 'owner');
    const created = await request(ALPHA, 'hold.then.revoked@okbank', owner);
    await approve(created.id);
    await revokeAdminSessions(as('admin'), fresh(), { adminId: owner.adminId, now: NOW });
    expect(await raw('payment_profiles').findOne({ _id: idOf(created.id) })).toMatchObject({
      status: 'rejected',
      open: false,
      reject_code: 'requester_removed',
    });
    const later = await run(new Date(NOW.getTime() + 20 * HOLD * MINUTE));
    expect(later.activated.map((entry) => idText(entry.profileId))).not.toContain(created.id);
  });

  it('a request that slipped past a removal (committed alongside it) is refused at approval and closed', async () => {
    await closeOpen(ALPHA);
    const owner = await member(ALPHA, 'owner');
    const created = await request(ALPHA, 'race.approve@okbank', owner);
    // The race: the membership disappears without the removal seeing the request.
    await raw('masjid_admins').deleteOne({ masjid_id: ALPHA, admin_id: owner.adminId });
    expect(await code(approve(created.id))).toBe('PAYMENT_REQUESTER_REMOVED');
    expect(await raw('payment_profiles').findOne({ _id: idOf(created.id) })).toMatchObject({
      status: 'rejected',
      open: false,
      reject_code: 'requester_removed',
    });
  });

  it('activation checks again: a requester disabled during the hold is stopped, never live', async () => {
    await closeOpen(ALPHA);
    const owner = await member(ALPHA, 'owner');
    const created = await request(ALPHA, 'race.activate@okbank', owner);
    await approve(created.id);
    await raw('admin_users').updateOne({ _id: owner.adminId }, { $set: { status: 'disabled' } });
    const result = await run(new Date(NOW.getTime() + 21 * HOLD * MINUTE));
    expect(result.stopped.map((id) => idText(id))).toEqual([created.id]);
    expect(result.activated.map((entry) => idText(entry.profileId))).not.toContain(created.id);
    expect(await statusOf(created.id)).toBe('rejected');
  });

  it('the session that asked: a plain logout keeps the request; shutting the session out stops it', async () => {
    await closeOpen(GAMMA);
    const owner = await member(GAMMA, 'owner');
    const asked = await sessionFor(owner.adminId);
    const ask = (vpa: string) =>
      requestPaymentChange(as('admin'), owner, {
        masjidId: GAMMA,
        vpa,
        payeeName: 'Test Masjid Committee',
        sessionId: asked,
        now: NOW,
      });
    const first = await ask('session.logout@okbank');
    expect((await raw('payment_profiles').findOne({ _id: idOf(first.id) }))?.['requested_session']).toEqual(asked);
    await revokeSessions(as('admin'), owner, { sessionId: asked, reason: 'logout', now: NOW });
    expect(await statusOf(first.id)).toBe('pending');
    await approve(first.id); // still the owner's request after a sign-out
    expect(await statusOf(first.id)).toBe('approved_on_hold');

    await closeOpen(GAMMA);
    const other = await sessionFor(owner.adminId);
    const second = await requestPaymentChange(as('admin'), owner, {
      masjidId: GAMMA,
      vpa: 'session.revoked@okbank',
      payeeName: 'Test Masjid Committee',
      sessionId: other,
      now: NOW,
    });
    // "Sign out that device" from another phone — a hijacked session is cut off, and its change with it.
    await revokeSessions(as('admin'), owner, {
      sessionId: other,
      reason: 'revoked_by_admin',
      requestId: 'r',
      now: NOW,
    });
    expect(await raw('payment_profiles').findOne({ _id: idOf(second.id) })).toMatchObject({
      status: 'rejected',
      reject_code: 'requester_removed',
    });
  });
});
