// PHASE_01 T1.12: no secrets in logs during the auth and Super Admin flows (log capture test). Runs the flows with a
// capturing logger at debug level and searches every line for invite tokens, session tokens, the pepper, phone
// numbers (clear and encrypted) and the cookie header.
import { randomBytes } from 'node:crypto';

import { createDbHandle, type DbHandle, publicScope } from '@mc/db';
import { runMigrations } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';
import { registerCredential } from '@mc/db/state';
import { createTestDatabase, type TestDatabase, testMongoUri } from '@mc/db/testing';
import { ManualClock } from '@mc/shared/clock';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAdminApp } from '../src/app.ts';
import { sessionAuthenticator } from '../src/auth/session.ts';
import { type FieldKeyRing, hashToken, newToken } from '../src/crypto/field.ts';
import { memoryRateLimiter } from '../src/http/rate-limit.ts';
import { bootstrapSuperAdminInvite } from '../src/jobs/bootstrap-super-admin.ts';
import { adminRoutes } from '../src/routes/index.ts';
import { captureLogger, passkeyDeps } from './helpers.ts';

const ORIGIN = 'https://admin.test';
const CSRF = { Origin: ORIGIN, 'X-MC-CSRF': '1' };
const pepper = randomBytes(32);
const keyRing: FieldKeyRing = { currentId: 'k1', keys: new Map([['k1', randomBytes(32)]]) };
const clock = new ManualClock(new Date('2026-10-16T09:00:00Z'));
const PHONE = '+919812345678';

let test: TestDatabase | undefined;
let handle: DbHandle | undefined;
const h = () => {
  if (!handle) throw new Error('no handle');
  return handle;
};

beforeAll(async () => {
  test = await createTestDatabase('log_hygiene');
  await runMigrations(test.db, MIGRATIONS);
  handle = createDbHandle({ uri: testMongoUri(), database: test.name, process: 'script', local: true });
});

afterAll(async () => {
  await handle?.close();
  await test?.dispose();
});

describe('log hygiene (T1.12)', () => {
  it('auth + Super Admin flows log no token, cookie, pepper or phone number', async () => {
    const { logger, lines } = captureLogger();
    const app = createAdminApp({
      logger,
      release: 't',
      trustedProxyMode: 'none',
      adminOrigin: ORIGIN,
      clock,
      rateLimiter: memoryRateLimiter(),
      authenticate: sessionAuthenticator({ db: h(), pepper, clock }),
      ...adminRoutes({ db: h(), pepper, adminOrigin: ORIGIN, keyRing, ...passkeyDeps(ORIGIN, clock, logger) }),
    }).app;
    const secrets: string[] = [pepper.toString('base64'), pepper.toString('hex'), PHONE, PHONE.slice(3)];

    const { inviteUrl } = await bootstrapSuperAdminInvite(h(), {
      displayName: 'Test Owner',
      uiLocale: 'en',
      force: false,
      adminOrigin: ORIGIN,
      pepper,
      now: clock.now(),
    });
    const inviteToken = new URL(inviteUrl).hash.slice(1);
    secrets.push(inviteToken);
    await request(app).get(`/api/admin/auth/invite/${inviteToken}`);
    await request(app).get(`/api/admin/auth/invite/${newToken()}`); // unknown token: 404, still not logged
    const sessionToken = newToken();
    secrets.push(sessionToken);
    await registerCredential(h(), publicScope(), {
      inviteTokenHash: hashToken(inviteToken, pepper),
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
    const cookie = `__Host-mc_sess=${sessionToken}`;
    await request(app).get('/api/admin/auth/me').set('Cookie', cookie);
    const masjid = await request(app).post('/api/super/masjids').set(CSRF).set('Cookie', cookie).send({
      name: 'Test Masjid Zeta',
      area: 'A',
      city: 'Hyderabad',
      state: 'Telangana',
      address: 'x',
      lat: 17.4,
      lng: 78.5,
    });
    const admin = await request(app)
      .post('/api/super/admins')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({
        displayName: 'Test Admin',
        phone: PHONE,
        uiLocale: 'en',
        masjidId: (masjid.body as { id: string }).id,
        role: 'owner',
      });
    const created = admin.body as { adminId: string; inviteUrl: string };
    secrets.push(new URL(created.inviteUrl).hash.slice(1));
    const stored = await test?.db
      .collection<{ display_name: string; phone_enc?: string }>('admin_users')
      .findOne({ display_name: 'Test Admin' });
    if (stored?.phone_enc) secrets.push(stored.phone_enc);
    await test?.db
      .collection<{ token_hash: Buffer; step_up_at: Date }>('admin_sessions')
      .updateOne({ token_hash: hashToken(sessionToken, pepper) }, { $set: { step_up_at: clock.now() } });
    const phone = await request(app).get(`/api/super/admins/${created.adminId}/phone`).set('Cookie', cookie);
    expect(phone.body).toEqual({ phone: PHONE });
    await request(app).post('/api/admin/auth/logout').set(CSRF).set('Cookie', cookie);
    await request(app).get('/api/admin/auth/me').set('Cookie', cookie); // 401 after logout

    const log = JSON.stringify(lines());
    expect(lines().length).toBeGreaterThan(5);
    for (const secret of secrets) expect(log, 'a secret reached the log').not.toContain(secret);
    expect(log).not.toMatch(/__Host-mc_sess|cookie|authorization/i);
  });
});
