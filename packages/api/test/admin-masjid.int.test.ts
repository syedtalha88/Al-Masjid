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
import { adminMasjidStatsSchema, adminScheduleSchema, pushQuotaSchema } from '@mc/shared/contracts';
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
