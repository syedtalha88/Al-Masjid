// PHASE_01 T1.8 (session side) against a migrated MongoDB: uniform invite 404s, cookie session authentication, the
// Origin/CSRF guard on unsafe requests, idle expiry with a controlled clock, revoking a session logs that device out on
// its next request, logout clears the cookie, Super Admin and step-up route guards.
import { randomBytes } from 'node:crypto';

import { createDbHandle, type DbHandle, newId, publicScope, superScope } from '@mc/db';
import { runMigrations } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';
import {
  addAdminToMasjid,
  createAdmin,
  createInvite,
  createMasjid,
  registerCredential,
  SESSION_LIFETIMES,
} from '@mc/db/state';
import { createTestDatabase, type TestDatabase, testMongoUri } from '@mc/db/testing';
import { ManualClock } from '@mc/shared/clock';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createAdminApp } from '../src/app.ts';
import { sessionAuthenticator } from '../src/auth/session.ts';
import { hashToken, newToken } from '../src/crypto/field.ts';
import { defineRoute } from '../src/http/define-route.ts';
import { memoryRateLimiter } from '../src/http/rate-limit.ts';
import { adminSessionRoutes } from '../src/routes/admin-auth.ts';
import { silentLogger } from './helpers.ts';

const ORIGIN = 'https://admin.test';
const CSRF = { Origin: ORIGIN, 'X-MC-CSRF': '1' };
const pepper = randomBytes(32);
const clock = new ManualClock(new Date('2026-10-16T06:00:00Z'));

let test: TestDatabase | undefined;
let handle: DbHandle | undefined;
const h = () => {
  if (!handle) throw new Error('no handle');
  return handle;
};
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
let superId = newId();
const superNow = () => superScope(superId, clock.now());

const probe = (auth: 'super' | 'super_step_up') =>
  defineRoute({
    method: 'get',
    path: `/probe/${auth}`,
    summary: 'test probe',
    auth,
    responses: { 200: z.object({ ok: z.literal(true) }) },
    handler: ({ reply }) => reply(200, { ok: true }),
  });

const app = () =>
  createAdminApp({
    logger: silentLogger(),
    release: 't',
    trustedProxyMode: 'none',
    adminOrigin: ORIGIN,
    clock,
    rateLimiter: memoryRateLimiter(),
    authenticate: sessionAuthenticator({ db: h(), pepper, clock }),
    routes: [...adminSessionRoutes({ db: h(), pepper, adminOrigin: ORIGIN }), probe('super'), probe('super_step_up')],
  }).app;

/** A masjid admin with an open invite (token returned in clear, as the invite link carries it). */
async function invited() {
  const adminId = await createAdmin(h(), superNow(), { displayName: 'Test Admin', uiLocale: 'ur' });
  const { id: masjidId } = await createMasjid(h(), superNow(), {
    name: 'Test Masjid Gamma',
    area: 'Test Area',
    city: 'Hyderabad',
    state: 'Telangana',
    address: 'Test address',
    lat: 17.4,
    lng: 78.5,
  });
  await addAdminToMasjid(h(), superNow(), { masjidId, adminId, role: 'editor' });
  const token = newToken();
  await createInvite(h(), superNow(), {
    adminId,
    purpose: 'register',
    tokenHash: hashToken(token, pepper),
    now: clock.now(),
  });
  return { adminId, masjidId, token };
}

/** A registered admin with a session cookie (registration itself is tested in @mc/db). */
async function signedIn() {
  const i = await invited();
  const sessionToken = newToken();
  const result = await registerCredential(h(), publicScope(), {
    inviteTokenHash: hashToken(i.token, pepper),
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
  return { ...i, ...result, cookie: `__Host-mc_sess=${sessionToken}` };
}

beforeAll(async () => {
  test = await createTestDatabase('admin_auth');
  await runMigrations(t().db, MIGRATIONS);
  handle = createDbHandle({ uri: testMongoUri(), database: t().name, process: 'script', local: true });
  // The Super Admin (bootstrap is T1.9): created like any admin, then promoted.
  superId = await createAdmin(h(), superScope(newId(), clock.now()), { displayName: 'Test Super', uiLocale: 'en' });
  await t()
    .db.collection<{ _id: typeof superId; role: string; status: string }>('admin_users')
    .updateOne({ _id: superId }, { $set: { role: 'super_admin', status: 'active' } });
});

afterAll(async () => {
  await handle?.close();
  await test?.dispose();
});

describe('GET /auth/invite/:token', () => {
  it('shows a valid invite without using it; every invalid one is the same 404', async () => {
    const { token } = await invited();
    const ok = await request(app()).get(`/api/admin/auth/invite/${token}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({
      adminDisplayName: 'Test Admin',
      masjidNames: ['Test Masjid Gamma'],
      purpose: 'register',
      uiLocale: 'ur',
    });
    expect((await request(app()).get(`/api/admin/auth/invite/${token}`)).status).toBe(200); // not consumed
    const bodies: string[] = [];
    // One character off — the first: all 6 of its bits count (the last one carries padding bits, and a fixed 'A' there
    // equals the real token 1 time in 16 — a CI flake on 19 Oct 2026).
    const oneOff = `${token.startsWith('A') ? 'B' : 'A'}${token.slice(1)}`;
    for (const bad of [newToken(), 'short', oneOff]) {
      const response = await request(app()).get(`/api/admin/auth/invite/${bad}`);
      expect(response.status).toBe(404);
      const { requestId: _ignored, ...rest } = JSON.parse(response.text) as Record<string, unknown>;
      bodies.push(JSON.stringify(rest));
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain('INVITE_INVALID');
  });
});

describe('session cookie authentication', () => {
  it('GET /auth/me: 401 without a valid cookie, the admin and masjids with one', async () => {
    const s = await signedIn();
    expect((await request(app()).get('/api/admin/auth/me')).status).toBe(401);
    expect(
      (await request(app()).get('/api/admin/auth/me').set('Cookie', `__Host-mc_sess=${newToken()}`)).body,
    ).toMatchObject({ code: 'SESSION_REQUIRED' });
    const me = await request(app()).get('/api/admin/auth/me').set('Cookie', s.cookie);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      admin: { displayName: 'Test Admin', role: 'masjid_admin', uiLocale: 'ur' },
      masjids: [{ name: 'Test Masjid Gamma', role: 'editor' }],
      undertakingRequired: true,
    });
    // A planted duplicate cookie is ignored rather than guessed between.
    const twice = await request(app())
      .get('/api/admin/auth/me')
      .set('Cookie', `${s.cookie}; __Host-mc_sess=${newToken()}`);
    expect(twice.status).toBe(401);
  });

  it('idle expiry with a controlled clock (masjid admin: 7 days without a request)', async () => {
    const s = await signedIn();
    const start = clock.now();
    clock.advance(SESSION_LIFETIMES.masjid_admin.idleMs - 60_000);
    expect((await request(app()).get('/api/admin/auth/me').set('Cookie', s.cookie)).status).toBe(200);
    clock.advance(SESSION_LIFETIMES.masjid_admin.idleMs + 60_000); // the request above refreshed the idle window
    expect((await request(app()).get('/api/admin/auth/me').set('Cookie', s.cookie)).status).toBe(401);
    clock.set(start);
  });

  it('revoking a session logs that device out on its next request; unknown ids still answer 204', async () => {
    const s = await signedIn();
    const listed = await request(app()).get('/api/admin/auth/sessions').set('Cookie', s.cookie);
    expect(listed.body).toMatchObject({ sessions: [{ current: true }] });
    expect(JSON.stringify(listed.body)).not.toMatch(/token/i);
    const other = await signedIn();
    const otherId = (
      (await request(app()).get('/api/admin/auth/sessions').set('Cookie', other.cookie)).body as {
        sessions: { id: string }[];
      }
    ).sessions[0]?.id;
    // Someone else's session id: 204, nothing revoked.
    const cross = await request(app())
      .delete(`/api/admin/auth/sessions/${String(otherId)}`)
      .set(CSRF)
      .set('Cookie', s.cookie);
    expect(cross.status).toBe(204);
    expect((await request(app()).get('/api/admin/auth/me').set('Cookie', other.cookie)).status).toBe(200);
    // Own session revoked from "another device" (here: the same cookie) → next request is 401.
    const ownId = (listed.body as { sessions: { id: string }[] }).sessions[0]?.id;
    const revoked = await request(app())
      .delete(`/api/admin/auth/sessions/${String(ownId)}`)
      .set(CSRF)
      .set('Cookie', s.cookie);
    expect(revoked.status).toBe(204);
    expect((await request(app()).get('/api/admin/auth/me').set('Cookie', s.cookie)).status).toBe(401);
  });

  it('logout needs the CSRF header + Origin, revokes the session and clears the cookie with all flags', async () => {
    const s = await signedIn();
    expect((await request(app()).post('/api/admin/auth/logout').set('Cookie', s.cookie)).status).toBe(403);
    const foreign = await request(app())
      .post('/api/admin/auth/logout')
      .set({ Origin: 'https://evil.test', 'X-MC-CSRF': '1' })
      .set('Cookie', s.cookie);
    expect(foreign.status).toBe(403);
    expect((await request(app()).get('/api/admin/auth/me').set('Cookie', s.cookie)).status).toBe(200);
    const out = await request(app()).post('/api/admin/auth/logout').set(CSRF).set('Cookie', s.cookie);
    expect(out.status).toBe(204);
    expect(out.headers['set-cookie']).toEqual([
      '__Host-mc_sess=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict',
    ]);
    expect((await request(app()).get('/api/admin/auth/me').set('Cookie', s.cookie)).status).toBe(401);
  });

  it('passkeys: list, rename own (404 otherwise), add-device link; log out everywhere', async () => {
    const s = await signedIn();
    const other = await signedIn();
    const list = await request(app()).get('/api/admin/auth/passkeys').set('Cookie', s.cookie);
    const [passkey] = (list.body as { passkeys: { id: string; label: string }[] }).passkeys;
    expect(passkey?.label).toBe('Test phone');
    expect(JSON.stringify(list.body)).not.toMatch(/public|credential/i);
    const renamed = await request(app())
      .patch(`/api/admin/auth/passkeys/${String(passkey?.id)}`)
      .set(CSRF)
      .set('Cookie', s.cookie)
      .send({ label: 'Redmi 12' });
    expect(renamed.status).toBe(204);
    const theirs = (
      (await request(app()).get('/api/admin/auth/passkeys').set('Cookie', other.cookie)).body as {
        passkeys: { id: string }[];
      }
    ).passkeys[0]?.id;
    const cross = await request(app())
      .patch(`/api/admin/auth/passkeys/${String(theirs)}`)
      .set(CSRF)
      .set('Cookie', s.cookie)
      .send({ label: 'x' });
    expect(cross.status).toBe(404);
    const link = await request(app()).post('/api/admin/auth/passkeys/invite').set(CSRF).set('Cookie', s.cookie);
    expect(link.status).toBe(201);
    const token = new URL((link.body as { inviteUrl: string }).inviteUrl).hash.slice(1);
    expect((await request(app()).get(`/api/admin/auth/invite/${token}`)).body).toMatchObject({ purpose: 'add_device' });

    const all = await request(app()).delete('/api/admin/auth/sessions').set(CSRF).set('Cookie', s.cookie);
    expect(all.status).toBe(204);
    expect(all.headers['set-cookie']).toEqual([
      '__Host-mc_sess=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict',
    ]);
    expect((await request(app()).get('/api/admin/auth/me').set('Cookie', s.cookie)).status).toBe(401);
    expect((await request(app()).get('/api/admin/auth/me').set('Cookie', other.cookie)).status).toBe(200);
  });

  it('super and step-up routes: masjid admins get 403 FORBIDDEN; a stale step-up gets STEP_UP_REQUIRED', async () => {
    const s = await signedIn();
    expect((await request(app()).get('/api/admin/probe/super').set('Cookie', s.cookie)).body).toMatchObject({
      code: 'FORBIDDEN',
    });
    await t()
      .db.collection<{ _id: typeof s.adminId; role: string }>('admin_users')
      .updateOne({ _id: s.adminId }, { $set: { role: 'super_admin' } });
    expect((await request(app()).get('/api/admin/probe/super').set('Cookie', s.cookie)).status).toBe(200);
    expect((await request(app()).get('/api/admin/probe/super_step_up').set('Cookie', s.cookie)).body).toMatchObject({
      code: 'STEP_UP_REQUIRED',
    });
    await t()
      .db.collection<{ _id: typeof s.sessionId; step_up_at: Date }>('admin_sessions')
      .updateOne({ _id: s.sessionId }, { $set: { step_up_at: clock.now() } });
    expect((await request(app()).get('/api/admin/probe/super_step_up').set('Cookie', s.cookie)).status).toBe(200);
    clock.advance(5 * 60_000 + 1000);
    expect((await request(app()).get('/api/admin/probe/super_step_up').set('Cookie', s.cookie)).body).toMatchObject({
      code: 'STEP_UP_REQUIRED',
    });
  });
});
