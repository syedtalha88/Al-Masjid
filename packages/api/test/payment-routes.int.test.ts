// PHASE_05 T5.2 (API) — the UPI change-lock over HTTP against a migrated MongoDB as api-admin's own database user: the
// admin requests (400 for a bad VPA, 409 for a second open request; the Super Admin is alerted), the Super Admin lists,
// approves ★ (403 without a fresh step-up; the requester is alerted; live after PAYMENT_HOLD_MINUTES) or rejects; the
// worker's `payment-activate` run puts the details live, starts the notice's fan-out and alerts the requester; the
// notice cannot be deleted (409 ITEM_LOCKED). Fake VPAs only.
import { randomUUID } from 'node:crypto';

import { parseId } from '@mc/db';
import { processUserHandle } from '@mc/db/testing';
import { adminPaymentSchema, superPaymentListSchema } from '@mc/shared/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { processPaymentActivate } from '../src/jobs/payments/activate.ts';
import { createLogger } from '../src/logger.ts';
import type { AlertService } from '../src/queue/alerts.ts';
import type { JobQueues } from '../src/queue/queues.ts';
import { CSRF, superHarness } from './super-harness.ts';

const HOLD = 15; // minutes — the staging value (owner guide 5.3)
const raised: Parameters<AlertService['raise']>[0][] = [];
const extra = {
  alerts: {
    raise: (input: Parameters<AlertService['raise']>[0]) => {
      raised.push(input);
      return Promise.resolve(true);
    },
  },
  paymentHoldMinutes: HOLD,
};
const harness = superHarness('payment_routes', new Date('2026-11-10T06:30:00Z'), extra);
const { app, asSuper, stepUp, register, testDatabase, clock, activatePaymentNotice } = harness;

let masjidId = '';
let adminCookie = '';
let adminId = '';

const offset = (jamaatOffsetMin: number) => ({
  adhanMode: 'auto',
  adhanAdjustMin: 0,
  jamaatMode: 'offset',
  jamaatOffsetMin,
});
const asAdmin = (method: 'get' | 'post' | 'delete', path: string) => {
  const call = request(app())[method](`/api/admin/masjids/${masjidId}${path}`).set('Cookie', adminCookie);
  return method === 'get' ? call : call.set(CSRF);
};
const errorCode = (response: request.Response) => (response.body as { code?: string }).code;

/** Records what the worker enqueues. */
const enqueued: { name: string; payload: unknown; jobId: string | undefined }[] = [];
const queues = {
  enqueue: (name: string, payload: unknown, options?: { jobId?: string }) => {
    enqueued.push({ name, payload, jobId: options?.jobId });
    return Promise.resolve();
  },
  queue: () => {
    throw new Error('not used');
  },
  close: () => Promise.resolve(),
} as unknown as JobQueues; // only `enqueue` is called by processPaymentActivate

async function runActivation() {
  const system = await processUserHandle(testDatabase(), 'mc_system');
  try {
    return await processPaymentActivate({
      db: system.handle,
      queues,
      clock,
      logger: createLogger({ level: 'silent', process: 'worker', release: 't' }),
    });
  } finally {
    await system.dispose();
  }
}

beforeAll(async () => {
  await activatePaymentNotice(); // approval needs it (DECISIONS #160)
  const masjid = await asSuper('post', '/masjids').send({
    name: 'Test Masjid Pay',
    area: 'Test Area',
    city: 'Hyderabad',
    state: 'Telangana',
    address: 'Test address',
    lat: 17.385,
    lng: 78.4867,
  });
  masjidId = (masjid.body as { id: string }).id;
  const admin = await asSuper('post', '/admins').send({
    displayName: 'Test Imam',
    uiLocale: 'en',
    masjidId,
    role: 'owner',
  });
  adminId = (admin.body as { adminId: string }).adminId;
  adminCookie = await register((admin.body as { inviteUrl: string }).inviteUrl);
  const settings = await asSuper('get', '/settings');
  const version = (settings.body as { undertakingVersion: string }).undertakingVersion;
  await request(app()).post('/api/admin/auth/undertaking').set(CSRF).set('Cookie', adminCookie).send({ version });
  const timings = await request(app())
    .put(`/api/admin/masjids/${masjidId}/timings`)
    .set('Cookie', adminCookie)
    .set(CSRF)
    .set('If-Match', '"0"')
    .send({
      prayers: { fajr: offset(20), dhuhr: offset(15), asr: offset(15), maghrib: offset(5), isha: offset(15) },
      jumuah: [{ seq: 1, jamaatTime: '13:30' }],
      notify: false,
    });
  expect(timings.status).toBe(200);
  expect((await asSuper('post', `/masjids/${masjidId}/activate`)).status).toBe(204);
});

describe('request → approve ★ → hold → live', () => {
  let requestId = '';

  it('the admin starts with nothing; a bad VPA is 400; a request is 201 and alerts the Super Admin', async () => {
    const empty = await asAdmin('get', '/payment');
    expect(empty.status).toBe(200);
    expect(adminPaymentSchema.parse(empty.body)).toEqual({ active: null, request: null });
    const bad = await asAdmin('post', '/payment/requests').send({ vpa: 'pay me@bank', payeeName: 'Test Committee' });
    expect([bad.status, errorCode(bad)]).toEqual([400, 'PAYMENT_INVALID']);
    const extraField = await asAdmin('post', '/payment/requests').send({ vpa: 'a.b@okbank', payeeName: 'X', am: '1' });
    expect(extraField.status).toBe(400); // strict body: no amount or anything else
    const created = await asAdmin('post', '/payment/requests').send({
      vpa: 'test.masjid@OKBANK',
      payeeName: 'Test Masjid Committee',
      note: 'Committee account',
    });
    expect(created.status).toBe(201);
    requestId = (created.body as { id: string }).id;
    expect(raised.at(-1)).toEqual({ type: 'payment_request', to: { kind: 'super' }, key: requestId });
    const again = await asAdmin('post', '/payment/requests').send({ vpa: 'other.vpa@okbank', payeeName: 'X' });
    expect([again.status, errorCode(again)]).toEqual([409, 'PAYMENT_REQUEST_OPEN']);
    const status = adminPaymentSchema.parse((await asAdmin('get', '/payment')).body);
    expect(status.request).toMatchObject({ id: requestId, status: 'pending', vpa: 'test.masjid@okbank' });
  });

  it('the queue is Super Admin only and shows the request with the masjid and requester', async () => {
    const list = await asSuper('get', '/payments/pending');
    expect(list.status).toBe(200);
    const row = superPaymentListSchema.parse(list.body).requests.find((entry) => entry.id === requestId);
    expect(row).toMatchObject({
      masjid: { id: masjidId, name: 'Test Masjid Pay', city: 'Hyderabad' },
      requestedBy: { id: adminId, displayName: 'Test Imam' },
      current: null,
    });
    const asAdminUser = await request(app()).get('/api/super/payments/pending').set('Cookie', adminCookie);
    expect(asAdminUser.status).toBe(403);
  });

  it('approve without a fresh step-up is 403; with it, 200 and live after the hold; the requester is alerted', async () => {
    await stepUp(false);
    const refused = await asSuper('post', `/payments/${requestId}/approve`).send({});
    expect([refused.status, errorCode(refused)]).toEqual([403, 'STEP_UP_REQUIRED']);
    await stepUp(true);
    const approved = await asSuper('post', `/payments/${requestId}/approve`).send({});
    expect(approved.status).toBe(200);
    const effectiveAt = new Date(clock.now().getTime() + HOLD * 60_000).toISOString();
    expect(approved.body).toEqual({ effectiveAt });
    expect(raised.at(-1)).toEqual({
      type: 'payment_approved',
      to: { kind: 'admins', adminIds: [adminId] },
      key: requestId,
    });
    const twice = await asSuper('post', `/payments/${requestId}/approve`).send({});
    expect([twice.status, errorCode(twice)]).toEqual([409, 'PAYMENT_NOT_PENDING']);
    const unknown = await asSuper('post', `/payments/${randomUUID()}/approve`).send({});
    expect([unknown.status, errorCode(unknown)]).toEqual([404, 'PAYMENT_NOT_FOUND']);
    const status = adminPaymentSchema.parse((await asAdmin('get', '/payment')).body);
    expect(status).toMatchObject({ active: null, request: { status: 'approved_on_hold', effectiveAt } });
  });

  it('the worker run activates after the hold: fan-out + alert enqueued; the notice cannot be deleted', async () => {
    clock.set(new Date(clock.now().getTime() + (HOLD - 1) * 60_000));
    expect(await runActivation()).toEqual({ activated: 0 });
    clock.set(new Date(clock.now().getTime() + 60_000));
    expect(await runActivation()).toEqual({ activated: 1 });
    const fanout = enqueued.find((entry) => entry.name === 'push-fanout');
    expect(fanout?.jobId).toEqual((fanout?.payload as { jobId: string }).jobId);
    expect(enqueued.find((entry) => entry.name === 'alert-send')).toMatchObject({
      payload: {
        alertId: `payment_active.${requestId}`,
        to: { kind: 'admins', adminIds: [adminId] },
        alert: { type: 'payment_active' },
      },
    });
    const status = adminPaymentSchema.parse((await asAdmin('get', '/payment')).body);
    expect(status).toEqual({
      active: {
        vpa: 'test.masjid@okbank',
        payeeName: 'Test Masjid Committee',
        effectiveAt: expect.any(String) as string,
      },
      request: null,
    });
    const notice = await testDatabase()
      .db.collection('items')
      .findOne({ template_key: 'payment_details_updated', masjid_id: parseId(masjidId) });
    const itemId = (notice?._id as { toHexString(dashes: boolean): string } | undefined)?.toHexString(true) ?? '';
    const deleted = await asAdmin('delete', `/items/${itemId}`);
    expect([deleted.status, errorCode(deleted)]).toEqual([409, 'ITEM_LOCKED']);
  });

  it('reject is 204 with a reason; the requester is alerted and sees why (rejecting during the hold: db payment.int)', async () => {
    const created = await asAdmin('post', '/payment/requests').send({ vpa: 'second.vpa@okbank', payeeName: 'X' });
    const id = (created.body as { id: string }).id;
    const noReason = await asSuper('post', `/payments/${id}/reject`).send({});
    expect(noReason.status).toBe(400);
    const rejected = await asSuper('post', `/payments/${id}/reject`).send({ reason: 'Payee name does not match' });
    expect(rejected.status).toBe(204);
    expect(raised.at(-1)).toEqual({ type: 'payment_rejected', to: { kind: 'admins', adminIds: [adminId] }, key: id });
    const status = adminPaymentSchema.parse((await asAdmin('get', '/payment')).body);
    expect(status.request).toMatchObject({ id, status: 'rejected', rejectReason: 'Payee name does not match' });
    expect(status.active?.vpa).toBe('test.masjid@okbank');
  });
});
