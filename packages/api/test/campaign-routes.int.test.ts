// PHASE_05 T5.3 (API) — donation drives over HTTP as api-admin's own database user: no UPI details → 409; every
// validation rule (strict body, title, target ≥ ₹1,000 as integer paise, dates, another masjid's cover) → 400;
// create → 201 (notify counted like any publish); list; "Update amount" with its history; the target only up;
// completed; at most 3 active; the worker's daily close. Fake titles and amounts only.
import { processUserHandle } from '@mc/db/testing';
import { adminCampaignListSchema, itemPublishedSchema } from '@mc/shared/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { processCampaignClose } from '../src/jobs/campaigns/close.ts';
import { processPaymentActivate } from '../src/jobs/payments/activate.ts';
import { createLogger } from '../src/logger.ts';
import type { JobQueues } from '../src/queue/queues.ts';
import { CSRF, superHarness } from './super-harness.ts';

const harness = superHarness('campaign_routes', new Date('2026-11-10T06:30:00Z'), { paymentHoldMinutes: 1 });
const { app, asSuper, stepUp, register, testDatabase, clock, activatePaymentNotice } = harness;
const logger = createLogger({ level: 'silent', process: 'worker', release: 't' });
const noQueues = { enqueue: () => Promise.resolve() } as unknown as JobQueues; // only `enqueue` is called

let masjidId = '';
let cookie = '';
const offset = (jamaatOffsetMin: number) => ({
  adhanMode: 'auto',
  adhanAdjustMin: 0,
  jamaatMode: 'offset',
  jamaatOffsetMin,
});
const call = (method: 'get' | 'post' | 'patch', path: string) => {
  const built = request(app())[method](`/api/admin/masjids/${masjidId}/campaigns${path}`).set('Cookie', cookie);
  return method === 'get' ? built : built.set(CSRF);
};
const codeOf = (response: request.Response) => (response.body as { code?: string }).code;
const valid = {
  title: 'Test roof repair',
  purpose: 'repair',
  targetPaise: 10_000_000,
  startsOn: '2026-11-10',
  notify: false,
};

async function asSystem<T>(run: (db: Awaited<ReturnType<typeof processUserHandle>>['handle']) => Promise<T>) {
  const system = await processUserHandle(testDatabase(), 'mc_system');
  try {
    return await run(system.handle);
  } finally {
    await system.dispose();
  }
}

beforeAll(async () => {
  await activatePaymentNotice(); // approval needs it (DECISIONS #160)
  const masjid = await asSuper('post', '/masjids').send({
    name: 'Test Masjid Drive',
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
  cookie = await register((admin.body as { inviteUrl: string }).inviteUrl);
  const settings = await asSuper('get', '/settings');
  const version = (settings.body as { undertakingVersion: string }).undertakingVersion;
  await request(app()).post('/api/admin/auth/undertaking').set(CSRF).set('Cookie', cookie).send({ version });
  await request(app())
    .put(`/api/admin/masjids/${masjidId}/timings`)
    .set('Cookie', cookie)
    .set(CSRF)
    .set('If-Match', '"0"')
    .send({
      prayers: { fajr: offset(20), dhuhr: offset(15), asr: offset(15), maghrib: offset(5), isha: offset(15) },
      jumuah: [{ seq: 1, jamaatTime: '13:30' }],
      notify: false,
    });
  expect((await asSuper('post', `/masjids/${masjidId}/activate`)).status).toBe(204);
});

describe('donation drives (B8)', () => {
  let campaignId = '';

  it('without active UPI details: 409 CAMPAIGN_NO_PAYMENT', async () => {
    const response = await call('post', '').send(valid);
    expect([response.status, codeOf(response)]).toEqual([409, 'CAMPAIGN_NO_PAYMENT']);
  });

  it('after the change-lock the UPI details are live; invalid input is 400 by rule', async () => {
    const requested = await request(app())
      .post(`/api/admin/masjids/${masjidId}/payment/requests`)
      .set('Cookie', cookie)
      .set(CSRF)
      .send({ vpa: 'test.masjid@okbank', payeeName: 'Test Masjid Committee' });
    await stepUp(true);
    await asSuper('post', `/payments/${(requested.body as { id: string }).id}/approve`).send({});
    clock.set(new Date(clock.now().getTime() + 60_000));
    await asSystem((db) => processPaymentActivate({ db, queues: noQueues, clock, logger }));

    for (const [body, status, code] of [
      [{ ...valid, amount: 1 }, 400, 'VALIDATION_FAILED'], // strict body
      [{ ...valid, title: '' }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, targetPaise: 99_999 }, 400, 'VALIDATION_FAILED'], // under ₹1,000
      [{ ...valid, targetPaise: 1_000_000.5 }, 400, 'VALIDATION_FAILED'], // paise are integers
      [{ ...valid, purpose: 'other-thing' }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, endsOn: '2026-11-09' }, 400, 'CAMPAIGN_INVALID'], // before the start
      [
        {
          ...valid,
          cover: {
            key: 'm/00000000-0000-4000-8000-000000000000/11111111-1111-4111-8111-111111111111',
            thumbhash: 'AAAA',
            rightsConfirmed: true,
          },
        },
        400,
        'CAMPAIGN_INVALID',
      ],
    ] as const) {
      const response = await call('post', '').send(body);
      expect([response.status, codeOf(response)], JSON.stringify(body)).toEqual([status, code]);
    }
  });

  it('create 201; list shows it active at ₹0', async () => {
    const created = await call('post', '').send({ ...valid, description: 'Placeholder', endsOn: '2026-11-20' });
    expect(created.status).toBe(201);
    const published = itemPublishedSchema.parse(created.body);
    expect(published.notification).toBeNull();
    campaignId = published.item.id;
    const list = adminCampaignListSchema.parse((await call('get', '')).body);
    expect(list.campaigns[0]).toMatchObject({
      id: campaignId,
      status: 'active',
      targetPaise: 10_000_000,
      receivedPaise: 0,
      endsOn: '2026-11-20',
    });
  });

  it('"Update amount" 200 with a history row; the target only goes up; complete 204', async () => {
    const updated = await call('post', `/${campaignId}/received`).send({ receivedPaise: 7_200_000, notify: false });
    expect([updated.status, updated.body]).toEqual([200, { notification: null }]);
    expect(await testDatabase().db.collection('campaign_amount_history').countDocuments({})).toBe(1);
    const negative = await call('post', `/${campaignId}/received`).send({ receivedPaise: -1, notify: false });
    expect(negative.status).toBe(400);
    const lower = await call('patch', `/${campaignId}`).send({ targetPaise: 9_000_000 });
    expect([lower.status, codeOf(lower)]).toEqual([409, 'CAMPAIGN_TARGET_LOWER']);
    expect((await call('patch', `/${campaignId}`).send({ targetPaise: 20_000_000 })).status).toBe(204);
    // Only title / description / cover / end date / target (upward) may change: anything else is refused, and so is
    // a payee in the text (DECISIONS #160).
    for (const field of [
      { purpose: 'bills' },
      { startsOn: '2026-11-01' },
      { receivedPaise: 1 },
      { status: 'closed' },
    ]) {
      const refused = await call('patch', `/${campaignId}`).send(field);
      expect([refused.status, codeOf(refused)], JSON.stringify(field)).toEqual([400, 'VALIDATION_FAILED']);
    }
    const payee = await call('patch', `/${campaignId}`).send({ description: 'Pay test.person@okexample instead' });
    expect([payee.status, codeOf(payee)]).toEqual([400, 'PAYMENT_DETAILS_IN_TEXT']);
    expect((await call('post', `/${campaignId}/complete`).send({})).status).toBe(204);
    const again = await call('post', `/${campaignId}/complete`).send({});
    expect([again.status, codeOf(again)]).toEqual([409, 'CAMPAIGN_NOT_ACTIVE']);
  });

  it('at most 3 active (the completed one does not count)', async () => {
    for (const n of [1, 2, 3])
      expect((await call('post', '').send({ ...valid, title: `Drive ${String(n)}` })).status).toBe(201);
    const fourth = await call('post', '').send({ ...valid, title: 'Drive 4' });
    expect([fourth.status, codeOf(fourth)]).toEqual([409, 'CAMPAIGN_LIMIT_REACHED']);
  });

  it('the daily close ends drives past their end date; closed ones take no amounts', async () => {
    const back = clock.now();
    clock.set(new Date('2026-11-20T18:40:00Z')); // 00:10 IST on 21 Nov
    expect(await asSystem((db) => processCampaignClose({ db, clock, logger }))).toEqual({ closed: 1 });
    clock.set(back); // the admin's session is from the 10th
    const closed = await call('post', `/${campaignId}/received`).send({ receivedPaise: 1, notify: false });
    expect([closed.status, codeOf(closed)]).toEqual([409, 'CAMPAIGN_CLOSED']);
    const unknown = await call('post', '/not-an-id/complete').send({});
    expect([unknown.status, codeOf(unknown)]).toEqual([404, 'CAMPAIGN_NOT_FOUND']);
  });
});
