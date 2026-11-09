// PHASE_05 T5.2 — the UPI change-lock (04 R1, 02 payment_profiles) as the real `mc_admin` / `mc_system` / `mc_public`
// users: an admin only *requests* (one open request per masjid, also under concurrency); the Super Admin approves with
// a fresh step-up (→ on hold until `effective_at`) or rejects — also during the hold (DECISIONS #146); only the
// system job activates, at `effective_at`, superseding the previous profile, bumping the version and publishing the
// locked "Payment details updated" notice with a quota-free push. There is no other write path. Fake VPAs only.
import { type Long, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { PolicyDeniedError } from '../src/policy.ts';
import { getMasjidBundle } from '../src/repos/index.ts';
import { adminScope, superScope, systemScope } from '../src/scope.ts';
import { scoped } from '../src/scoped.ts';
import { buildDevSeed, seedId, writeDevSeed } from '../src/seed/index.ts';
import {
  activateDuePaymentProfiles,
  approvePaymentChange,
  deleteItem,
  editItem,
  PAYMENT_NOTICE_TEMPLATE,
  rejectPaymentChange,
  requestPaymentChange,
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
const adminOf = (masjid: UUID) => adminScope({ adminId: newId(), masjids: [{ id: masjid, role: 'owner' }] });
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
const activate = (at: Date) => activateDuePaymentProfiles(as('system'), systemScope(), { now: at });

beforeAll(async () => {
  test = await createTestDatabase('payment-state');
  await runMigrations(t().db, MIGRATIONS);
  handles.admin = await processUserHandle(t(), 'mc_admin');
  handles.public = await processUserHandle(t(), 'mc_public');
  handles.system = await processUserHandle(t(), 'mc_system');
  await writeDevSeed(as('system'), systemScope(), buildDevSeed({ now: NOW, today: TODAY }));
});

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
    expect(result).toEqual({ masjidId: BETA, requestedBy: pending?.['requested_by'] });
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
