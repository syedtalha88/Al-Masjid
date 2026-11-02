// PHASE_03 T3.1 (API) against a migrated MongoDB as the real mc_admin user: the masjid-scoped Admin Home reads —
// stats, push quota, schedule — for the admin's own masjid; another masjid, a malformed id and the Super Admin (not a
// member) all get the uniform 404; no session → 401.
import { randomBytes } from 'node:crypto';

import { type DbHandle, publicScope } from '@mc/db';
import { runMigrations } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';
import { registerCredential } from '@mc/db/state';
import { createTestDatabase, processUserHandle, type TestDatabase } from '@mc/db/testing';
import { ManualClock } from '@mc/shared/clock';
import {
  adminMasjidStatsSchema,
  adminScheduleSchema,
  pushQuotaSchema,
  timingsPreviewSchema,
  timingsSavedSchema,
} from '@mc/shared/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAdminApp } from '../src/app.ts';
import { sessionAuthenticator } from '../src/auth/session.ts';
import { type FieldKeyRing, hashToken, newToken } from '../src/crypto/field.ts';
import { memoryRateLimiter } from '../src/http/rate-limit.ts';
import { bootstrapSuperAdminInvite } from '../src/jobs/bootstrap-super-admin.ts';
import { adminRoutes } from '../src/routes/index.ts';
import { passkeyDeps, silentLogger } from './helpers.ts';

const ORIGIN = 'https://admin.test';
const CSRF = { Origin: ORIGIN, 'X-MC-CSRF': '1' };
const pepper = randomBytes(32);
const keyRing: FieldKeyRing = { currentId: 'k1', keys: new Map([['k1', randomBytes(32)]]) };
const clock = new ManualClock(new Date('2026-10-16T08:00:00Z')); // 13:30 IST

let test: TestDatabase | undefined;
let asAdmin: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const h = (): DbHandle => {
  if (!asAdmin) throw new Error('no handle');
  return asAdmin.handle;
};

const app = () =>
  createAdminApp({
    logger: silentLogger(),
    release: 't',
    trustedProxyMode: 'none',
    adminOrigin: ORIGIN,
    clock,
    rateLimiter: memoryRateLimiter(),
    authenticate: sessionAuthenticator({ db: h(), pepper, clock }),
    ...adminRoutes({ db: h(), pepper, adminOrigin: ORIGIN, keyRing, ...passkeyDeps(ORIGIN, clock) }),
  }).app;

async function register(inviteUrlText: string): Promise<string> {
  const token = new URL(inviteUrlText).hash.slice(1);
  const sessionToken = newToken();
  await registerCredential(h(), publicScope(), {
    inviteTokenHash: hashToken(token, pepper),
    credential: {
      id: randomBytes(32),
      publicKey: randomBytes(77),
      counter: 0,
      transports: ['internal'],
      backedUp: true,
      deviceType: 'multiDevice',
      label: 'Test phone',
    },
    sessionTokenHash: hashToken(sessionToken, pepper),
    now: clock.now(),
  });
  return `__Host-mc_sess=${sessionToken}`;
}

let superCookie = '';
let adminCookie = '';
let own = '';
let other = '';

beforeAll(async () => {
  test = await createTestDatabase('admin_masjid_routes');
  await runMigrations(test.db, MIGRATIONS);
  asAdmin = await processUserHandle(test, 'mc_admin');
  const { inviteUrl } = await bootstrapSuperAdminInvite(h(), {
    displayName: 'Test Owner',
    uiLocale: 'en',
    force: false,
    adminOrigin: ORIGIN,
    pepper,
    now: clock.now(),
  });
  superCookie = await register(inviteUrl);
  const asSuper = (path: string, body: object) =>
    request(app()).post(`/api/super${path}`).set('Cookie', superCookie).set(CSRF).send(body);
  const masjid = async (name: string) =>
    (
      (
        await asSuper('/masjids', {
          name,
          area: 'Test Area',
          city: 'Hyderabad',
          state: 'Telangana',
          address: 'Test address',
          lat: 17.385,
          lng: 78.4867,
        })
      ).body as { id: string }
    ).id;
  own = await masjid('Test Masjid Own');
  other = await masjid('Test Masjid Other');
  const admin = await asSuper('/admins', { displayName: 'Test Admin', uiLocale: 'en', masjidId: own, role: 'owner' });
  adminCookie = await register((admin.body as { inviteUrl: string }).inviteUrl);
  // Writes need the accepted undertaking (B2); the reads above are exempt.
  const settings = await request(app()).get('/api/super/settings').set('Cookie', superCookie);
  const version = (settings.body as { undertakingVersion: string }).undertakingVersion;
  await request(app()).post('/api/admin/auth/undertaking').set(CSRF).set('Cookie', adminCookie).send({ version });
});

afterAll(async () => {
  await asAdmin?.dispose();
  await test?.dispose();
});

const get = (path: string, cookie = adminCookie) =>
  request(app()).get(`/api/admin/masjids${path}`).set('Cookie', cookie);

describe('masjid-scoped Admin Home reads (T3.1)', () => {
  it('own masjid: stats, quota (reset at the next IST midnight) and schedule (no timings yet)', async () => {
    const stats = await get(`/${own}/stats`);
    expect(stats.status).toBe(200);
    expect(adminMasjidStatsSchema.parse(stats.body)).toEqual({ followers: 0, itemsThisWeek: 0, ameenThisWeek: 0 });

    const quota = await get(`/${own}/notifications/quota`);
    expect(quota.status).toBe(200);
    expect(pushQuotaSchema.parse(quota.body)).toEqual({ used: 0, limit: 8, resetsAt: '2026-10-16T18:30:00.000Z' });

    const schedule = await get(`/${own}/timings`);
    expect(schedule.status).toBe(200);
    expect(adminScheduleSchema.parse(schedule.body)).toMatchObject({
      masjid: { name: 'Test Masjid Own', calcMethod: 'karachi', asrMadhab: 'hanafi' },
      timings: null,
    });
  });

  it('another masjid, a malformed id and a non-member Super Admin get the same 404', async () => {
    for (const [path, cookie] of [
      [`/${other}/stats`, adminCookie],
      [`/${other}/notifications/quota`, adminCookie],
      [`/${other}/timings`, adminCookie],
      ['/not-a-uuid/stats', adminCookie],
      [`/${own}/timings`, superCookie],
    ] as const) {
      const response = await get(path, cookie);
      expect({ path, status: response.status, code: (response.body as { code?: string }).code }).toEqual({
        path,
        status: 404,
        code: 'MASJID_NOT_FOUND',
      });
    }
  });

  it('without a session: 401', async () => {
    const response = await request(app()).get(`/api/admin/masjids/${own}/stats`);
    expect(response.status).toBe(401);
  });
});

describe('timings editor API (T3.2)', () => {
  const offset = (jamaatOffsetMin: number) => ({
    adhanMode: 'auto',
    adhanAdjustMin: 0,
    jamaatMode: 'offset',
    jamaatOffsetMin,
  });
  const BODY = {
    prayers: { fajr: offset(20), dhuhr: offset(15), asr: offset(15), maghrib: offset(5), isha: offset(15) },
    jumuah: [{ seq: 1, khutbahTime: '13:00', jamaatTime: '13:30' }],
    notify: false,
  };
  const put = (body: object, ifMatch?: string, path = own, cookie = adminCookie) => {
    const call = request(app()).put(`/api/admin/masjids/${path}/timings`).set('Cookie', cookie).set(CSRF);
    return (ifMatch === undefined ? call : call.set('If-Match', ifMatch)).send(body);
  };

  it('the first save needs If-Match "0"; then the rev moves on and a stale one gets 412', async () => {
    expect((await put(BODY)).status).toBe(400); // no If-Match
    expect((await put(BODY, 'W/"abc"')).status).toBe(400);
    const first = await put(BODY, '"0"');
    expect(first.status).toBe(200);
    expect(timingsSavedSchema.parse(first.body)).toEqual({ rev: 1, item: null });
    const schedule = adminScheduleSchema.parse((await get(`/${own}/timings`)).body);
    expect(schedule.rev).toBe(1);
    expect(schedule.timings?.prayers.maghrib).toEqual(BODY.prayers.maghrib);
    const stale = await put(BODY, '"0"');
    expect({ status: stale.status, code: (stale.body as { code?: string }).code }).toEqual({
      status: 412,
      code: 'PRECONDITION_FAILED',
    });
    expect((await put(BODY, '1')).status).toBe(200); // quotes are optional
  });

  it('mode rules and the 00 §4.2 rules are refused with problem+json', async () => {
    const rev = adminScheduleSchema.parse((await get(`/${own}/timings`)).body).rev;
    // fixed jamaat without its time
    const missing = await put(
      { ...BODY, prayers: { ...BODY.prayers, asr: { adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'fixed' } } },
      String(rev),
    );
    expect(missing.status).toBe(400);
    expect((missing.body as { code?: string }).code).toBe('VALIDATION_FAILED');
    // Isha before Maghrib
    const isha = {
      adhanMode: 'manual',
      adhanTime: '17:00',
      adhanAdjustMin: 0,
      jamaatMode: 'fixed',
      jamaatTime: '17:05',
    };
    const broken = await put({ ...BODY, prayers: { ...BODY.prayers, isha } }, String(rev));
    expect({ status: broken.status, code: (broken.body as { code?: string }).code }).toEqual({
      status: 400,
      code: 'TIMINGS_INVALID',
    });
    // another masjid
    expect((await put(BODY, String(rev), other)).status).toBe(404);
  });

  it('notify publishes a timing update and counts against today’s quota', async () => {
    const rev = adminScheduleSchema.parse((await get(`/${own}/timings`)).body).rev;
    const saved = await put({ ...BODY, notify: true }, String(rev));
    expect(saved.status).toBe(200);
    expect(timingsSavedSchema.parse(saved.body).item?.publicId).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(pushQuotaSchema.parse((await get(`/${own}/notifications/quota`)).body).used).toBe(1);
  });

  it('preview: the saved timings resolved for a day', async () => {
    const preview = await get(`/${own}/timings/preview?date=2026-10-17`);
    expect(preview.status).toBe(200);
    const day = timingsPreviewSchema.parse(preview.body);
    expect(day.date).toBe('2026-10-17');
    expect(day.prayers.map((p) => p.prayer)).toEqual(['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']);
    expect(day.prayers.every((p) => p.calculated && p.jamaat !== null && p.jamaat >= p.adhan)).toBe(true);
    expect((await get(`/${own}/timings/preview?date=17-10-2026`)).status).toBe(400);
    expect((await get(`/${other}/timings/preview?date=2026-10-17`)).status).toBe(404);
  });
});
