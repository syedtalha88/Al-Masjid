// PHASE_08 T8.1 — `POST /reports` through the real app as mc_public: a device reports a post (public id) or a masjid
// (id) with Turnstile; urgent reasons get the 2-hour SLA and the urgent flag, the rest 36 hours (05 §3); bad bodies,
// mismatched ids, unknown targets, no device and a failed Turnstile are refused; the 11th report of a day is 429. The
// reporter gets only `{received: true}`. The two reason lists (shared compliance ↔ db enum) never drift.
import { idText, parseId } from '@mc/db';
import { runMigrations } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';
import { REPORT_REASON } from '@mc/db/schema';
import { seedId, seedPublicId } from '@mc/db/seed';
import { createTestDatabase, processUserHandle, type TestDatabase } from '@mc/db/testing';
import { ManualClock } from '@mc/shared/clock';
import { REPORT_REASONS } from '@mc/shared/compliance';
import { registerDeviceResponseSchema } from '@mc/shared/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPublicApp } from '../src/app.ts';
import { deviceAuthenticator } from '../src/auth/device.ts';
import { memoryRateLimiter } from '../src/http/rate-limit.ts';
import { runDevSeed } from '../src/jobs/seed.ts';
import { apiPublicRoutes } from '../src/routes/index.ts';
import { silentLogger } from './helpers.ts';

const NOW = new Date('2026-11-13T06:30:00Z');
const clock = new ManualClock(NOW);
const ALPHA = idText(seedId('masjid-alpha'));
const HOUR = 60 * 60 * 1000;

let test: TestDatabase | undefined;
let asPublic: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
let appInstance: ReturnType<typeof createPublicApp>['app'] | undefined;
const app = () => {
  if (!asPublic) throw new Error('no mc_public handle');
  const db = asPublic.handle;
  appInstance ??= createPublicApp({
    logger: silentLogger(),
    release: 't',
    trustedProxyMode: 'none',
    clock,
    rateLimiter: memoryRateLimiter(),
    authenticateDevice: deviceAuthenticator({ db, clock }),
    routes: apiPublicRoutes({ db, turnstile: (token) => Promise.resolve(token === 'turnstile-ok') }),
  }).app;
  return appInstance;
};

async function device() {
  const response = await request(app()).post('/api/v1/devices').send({
    locale: 'en',
    audiencePref: 'brothers',
    platform: 'android',
    privacyVersion: 'draft-1',
    turnstileToken: 'turnstile-ok',
  });
  expect(response.status).toBe(201);
  const parsed = registerDeviceResponseSchema.parse(response.body);
  return { id: parsed.deviceId, auth: `Device ${parsed.deviceId}.${parsed.secret}` };
}

const report = (auth: string | null, body: Record<string, unknown>) => {
  const call = request(app()).post('/api/v1/reports');
  return (auth ? call.set('Authorization', auth) : call).send({ turnstileToken: 'turnstile-ok', ...body });
};
const reportsOf = (deviceId: string) => {
  const id = parseId(deviceId);
  if (!id) throw new Error('bad device id');
  return t().db.collection('reports').find({ device_id: id }).toArray();
};

beforeAll(async () => {
  test = await createTestDatabase('report-routes');
  await runMigrations(t().db, MIGRATIONS);
  asPublic = await processUserHandle(t(), 'mc_public');
  asSystem = await processUserHandle(t(), 'mc_system');
  await runDevSeed(asSystem.handle, 'local', NOW);
});

afterAll(async () => {
  await asPublic?.dispose();
  await asSystem?.dispose();
  await test?.dispose();
});

describe('POST /reports', () => {
  it('the reason lists of the API and the database are the same', () => {
    expect([...REPORT_REASONS]).toEqual([...REPORT_REASON]);
  });

  it('a post report: 201 {received}, 36 hours, not urgent, details trimmed', async () => {
    const me = await device();
    const response = await report(me.auth, {
      targetType: 'item',
      targetPublicId: seedPublicId('alpha', 0),
      reason: 'misleading',
      details: '  Placeholder details  ',
    });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ received: true });
    const [stored] = await reportsOf(me.id);
    expect(stored).toMatchObject({
      target_type: 'item',
      reason: 'misleading',
      details: 'Placeholder details',
      urgent: false,
      status: 'open',
      sla_due_at: new Date(NOW.getTime() + 36 * HOUR),
    });
  });

  it('"personal or private information" is urgent: due in 2 hours', async () => {
    const me = await device();
    expect(
      (await report(me.auth, { targetType: 'item', targetPublicId: seedPublicId('alpha', 1), reason: 'private_info' }))
        .status,
    ).toBe(201);
    const [stored] = await reportsOf(me.id);
    expect(stored).toMatchObject({ urgent: true, sla_due_at: new Date(NOW.getTime() + 2 * HOUR) });
    expect(stored).not.toHaveProperty('details');
  });

  it('a masjid report by the masjid id', async () => {
    const me = await device();
    expect((await report(me.auth, { targetType: 'masjid', targetPublicId: ALPHA, reason: 'fraud' })).status).toBe(201);
    const [stored] = await reportsOf(me.id);
    expect(stored).toMatchObject({ target_type: 'masjid', reason: 'fraud' });
    expect(idText(stored?.['target_id'] as NonNullable<ReturnType<typeof parseId>>)).toBe(ALPHA);
  });

  it('refuses: no device 401, failed Turnstile 403, bad body 400, unknown target 404', async () => {
    const me = await device();
    const good = { targetType: 'item', targetPublicId: seedPublicId('alpha', 0), reason: 'other' };
    expect((await report(null, good)).status).toBe(401);
    expect((await report(me.auth, { ...good, turnstileToken: 'nope' })).status).toBe(403);
    expect((await report(me.auth, { ...good, reason: 'boring' })).status).toBe(400);
    expect((await report(me.auth, { ...good, targetType: 'masjid' })).status).toBe(400); // a public id is not a masjid id
    expect((await report(me.auth, { ...good, targetPublicId: ALPHA })).status).toBe(400);
    expect((await report(me.auth, { ...good, details: 'x'.repeat(501) })).status).toBe(400);
    expect((await report(me.auth, { ...good, details: 'bidi ‮ text' })).status).toBe(400);
    expect((await report(me.auth, { ...good, extra: 1 })).status).toBe(400);
    const unknown = await report(me.auth, { ...good, targetPublicId: 'seedZ0000000' });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ code: 'REPORT_TARGET_NOT_FOUND' });
    expect(
      (await report(me.auth, { ...good, targetType: 'masjid', targetPublicId: '00000000-0000-4000-8000-000000000000' }))
        .status,
    ).toBe(404);
    expect(await reportsOf(me.id)).toEqual([]);
  });

  it('10 a day per device, then 429', async () => {
    const me = await device();
    const good = { targetType: 'item', targetPublicId: seedPublicId('alpha', 2), reason: 'other' };
    for (let n = 0; n < 10; n += 1) expect((await report(me.auth, good)).status).toBe(201);
    expect((await report(me.auth, good)).status).toBe(429);
    expect(await reportsOf(me.id)).toHaveLength(10);
    // Another device is not affected.
    expect((await report((await device()).auth, good)).status).toBe(201);
  });
});
