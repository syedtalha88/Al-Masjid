// PHASE_01 T1.8 passkey ceremonies against a migrated MongoDB, with a software authenticator producing real signed
// WebAuthn responses: invite → register → logout → login → step-up → logout; invite reuse / expiry; challenge replay,
// expiry and purpose binding; wrong origin / RP ID; uv=false; foreign user handle; counter regression revokes (only
// after a valid signature); step-up only with the session owner's passkey; failures audited by credential hash only;
// cookie flags; CSRF on the new routes.
import { randomBytes } from 'node:crypto';

import { type DbHandle, idText, isId, newId, superScope } from '@mc/db';
import { runMigrations } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';
import { getDashboard } from '@mc/db/repos';
import { addAdminToMasjid, createAdmin, createInvite, createMasjid } from '@mc/db/state';
import { createTestDatabase, processUserHandle, type TestDatabase } from '@mc/db/testing';
import { ManualClock, ShiftableClock } from '@mc/shared/clock';
import { creationOptionsSchema, requestOptionsSchema } from '@mc/shared/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createAdminApp } from '../src/app.ts';
import { CHALLENGE_TTL_SEC } from '../src/auth/challenges.ts';
import { sessionAuthenticator } from '../src/auth/session.ts';
import { hashToken, newToken } from '../src/crypto/field.ts';
import { defineRoute } from '../src/http/define-route.ts';
import { memoryRateLimiter } from '../src/http/rate-limit.ts';
import { bootstrapSuperAdminInvite } from '../src/jobs/bootstrap-super-admin.ts';
import { adminSessionRoutes } from '../src/routes/admin-auth.ts';
import { adminPasskeyRoutes } from '../src/routes/admin-passkeys.ts';
import { testHookRoutes } from '../src/test-hooks/index.ts';
import { captureLogger, passkeyDeps } from './helpers.ts';
import { SoftAuthenticator, type SoftCredential } from './soft-authenticator.ts';

const ORIGIN = 'https://admin.test';
const CSRF = { Origin: ORIGIN, 'X-MC-CSRF': '1' };
const pepper = randomBytes(32);
const clock = new ManualClock(new Date('2026-10-20T06:00:00Z'));
const authenticator = new SoftAuthenticator(ORIGIN);
const log = captureLogger();

let test: TestDatabase | undefined;
let handle: DbHandle | undefined;
let asAdmin: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const h = () => {
  if (!handle) throw new Error('no handle');
  return handle;
};
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const raw = (name: string) => t().db.collection(name);

const probe = defineRoute({
  method: 'get',
  path: '/probe/step-up',
  summary: 'test probe',
  auth: 'super_step_up',
  responses: { 200: z.object({ ok: z.literal(true) }) },
  handler: ({ reply }) => reply(200, { ok: true }),
});

let built: ReturnType<typeof createAdminApp>['app'] | undefined;
const app = () => {
  built ??= createAdminApp({
    logger: log.logger,
    release: 't',
    trustedProxyMode: 'none',
    adminOrigin: ORIGIN,
    clock,
    // The 03 §2 limits themselves are tested in rate-limit tests; here many logins come from one test IP.
    rateLimiter: memoryRateLimiter({
      adminLoginIp: { points: 10_000, durationSec: 600 },
      adminLoginCredential: { points: 10_000, durationSec: 3600 },
      adminWrites: { points: 10_000, durationSec: 3600 },
    }),
    authenticate: sessionAuthenticator({ db: h(), pepper, clock }),
    routes: [
      ...adminSessionRoutes({ db: h(), pepper, adminOrigin: ORIGIN }),
      ...adminPasskeyRoutes({ db: h(), pepper, ...passkeyDeps(ORIGIN, clock, log.logger) }),
      probe,
    ],
  }).app;
  return built;
};

// --- helpers -------------------------------------------------------------------------------------------------------

/** All Set-Cookie lines of a response. */
const setCookies = (res: request.Response): string[] => {
  const header: unknown = res.headers['set-cookie'];
  return Array.isArray(header) ? header.filter((v): v is string => typeof v === 'string') : [];
};
/** The value a response set for `name` (`''` when it was cleared). */
const cookieValue = (res: request.Response, name: string): string | undefined => {
  const line = setCookies(res).findLast((c) => c.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(';')[0];
};

/** A masjid admin with an open register invite (token in clear, as the link carries it). */
async function invitedAdmin() {
  const superNow = superScope(newId(), clock.now());
  const adminId = await createAdmin(h(), superNow, { displayName: 'Test Admin', uiLocale: 'en' });
  const { id: masjidId } = await createMasjid(h(), superNow, {
    name: 'Test Masjid Delta',
    area: 'Test Area',
    city: 'Hyderabad',
    state: 'Telangana',
    address: 'Test address',
    lat: 17.4,
    lng: 78.5,
  });
  await addAdminToMasjid(h(), superNow, { masjidId, adminId, role: 'owner' });
  const token = newToken();
  await createInvite(h(), superNow, {
    adminId,
    purpose: 'register',
    tokenHash: hashToken(token, pepper),
    now: clock.now(),
  });
  return { adminId, token };
}

async function registerOptions(inviteToken: string) {
  const res = await request(app()).post('/api/admin/auth/register/options').set(CSRF).send({ inviteToken });
  return { res, options: res.status === 200 ? creationOptionsSchema.parse(res.body) : undefined };
}

/** Registers a passkey with the invite; returns the credential and the session cookie. */
async function register(inviteToken: string) {
  const { options } = await registerOptions(inviteToken);
  if (!options) throw new Error('no options');
  const { credential, response } = authenticator.create(options);
  const res = await request(app())
    .post('/api/admin/auth/register/verify')
    .set(CSRF)
    .send({ inviteToken, response, label: 'Test phone' });
  expect(res.status).toBe(204);
  return { credential, res, cookie: `__Host-mc_sess=${cookieValue(res, '__Host-mc_sess') ?? ''}` };
}

async function loginOptions() {
  const res = await request(app()).post('/api/admin/auth/login/options').set(CSRF);
  expect(res.status).toBe(200);
  return {
    res,
    options: requestOptionsSchema.parse(res.body),
    challengeCookie: `__Host-mc_chal=${cookieValue(res, '__Host-mc_chal') ?? ''}`,
  };
}

async function login(credential: SoftCredential, o: Parameters<SoftAuthenticator['get']>[2] = {}) {
  const { options, challengeCookie } = await loginOptions();
  const response = authenticator.get(options, credential, o);
  const res = await request(app())
    .post('/api/admin/auth/login/verify')
    .set(CSRF)
    .set('Cookie', challengeCookie)
    .send({ response });
  return { res, response, challengeCookie, cookie: `__Host-mc_sess=${cookieValue(res, '__Host-mc_sess') ?? ''}` };
}

async function stepUp(cookie: string, credential: SoftCredential, o: Parameters<SoftAuthenticator['get']>[2] = {}) {
  const opts = await request(app()).post('/api/admin/auth/step-up/options').set(CSRF).set('Cookie', cookie);
  expect(opts.status).toBe(200);
  const response = authenticator.get(requestOptionsSchema.parse(opts.body), credential, o);
  const res = await request(app())
    .post('/api/admin/auth/step-up/verify')
    .set(CSRF)
    .set('Cookie', cookie)
    .send({ response });
  return { res, cookie: `__Host-mc_sess=${cookieValue(res, '__Host-mc_sess') ?? ''}` };
}

const me = (cookie: string) => request(app()).get('/api/admin/auth/me').set('Cookie', cookie);
const failedLogins = () => raw('audit_log').countDocuments({ action: 'auth.login_failed' });
/** The reason logged for the most recent passkey failure (proves a case failed for ITS reason). */
const lastReason = (): string => {
  const line = log
    .lines()
    .findLast((l) => l['event'] === 'passkey.registration_failed' || l['event'] === 'passkey.assertion_failed');
  return typeof line?.['reason'] === 'string' ? line['reason'] : '';
};

beforeAll(async () => {
  test = await createTestDatabase('admin_passkeys');
  await runMigrations(t().db, MIGRATIONS);
  // As api-admin's own database user (02 §4.3), like on the servers — a missing privilege fails here.
  asAdmin = await processUserHandle(t(), 'mc_admin');
  handle = asAdmin.handle;
});

afterAll(async () => {
  await asAdmin?.dispose();
  await test?.dispose();
});

// --- the whole flow ------------------------------------------------------------------------------------------------

describe('invite → register → logout → login → step-up → logout (03 §4)', () => {
  it('masjid admin: options follow 04 §3, the session cookie has the 04 §4 flags, every step works', async () => {
    const { token } = await invitedAdmin();
    const { options } = await registerOptions(token);
    expect(options).toMatchObject({
      rp: { id: 'admin.test' },
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      attestation: 'none',
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      excludeCredentials: [],
    });
    expect(options?.user.name).toBe('Test Admin');

    const { credential, res, cookie } = await register(token);
    const sessionLine = setCookies(res).find((c) => c.startsWith('__Host-mc_sess='));
    expect(sessionLine).toMatch(/; Path=\/; Secure; HttpOnly; SameSite=Strict$/);
    expect(sessionLine).not.toMatch(/Domain=/i);
    expect(sessionLine).toMatch(/Max-Age=2592000;/); // masjid admin: absolute 30 days
    expect((await me(cookie)).body).toMatchObject({ admin: { displayName: 'Test Admin', role: 'masjid_admin' } });
    const stored = await raw('webauthn_credentials').findOne({ label: 'Test phone' });
    expect(stored).toMatchObject({ backed_up: true, device_type: 'multiDevice', transports: ['internal', 'hybrid'] });
    expect(stored).not.toHaveProperty('aaguid'); // all-zero AAGUID of attestation "none" is not stored

    expect((await request(app()).post('/api/admin/auth/logout').set(CSRF).set('Cookie', cookie)).status).toBe(204);
    expect((await me(cookie)).status).toBe(401);

    const signedIn = await login(credential);
    expect(signedIn.res.status).toBe(204);
    expect(cookieValue(signedIn.res, '__Host-mc_chal')).toBe(''); // the challenge cookie is cleared
    expect((await me(signedIn.cookie)).status).toBe(200);

    const stepped = await stepUp(signedIn.cookie, credential);
    expect(stepped.res.status).toBe(204);
    expect(stepped.cookie).not.toBe(signedIn.cookie); // rotated
    expect((await me(signedIn.cookie)).status).toBe(401); // the old token is gone
    expect((await me(stepped.cookie)).status).toBe(200);

    expect((await request(app()).post('/api/admin/auth/logout').set(CSRF).set('Cookie', stepped.cookie)).status).toBe(
      204,
    );
    expect((await me(stepped.cookie)).status).toBe(401);
    const actions: unknown[] = (await raw('audit_log').find({}).toArray()).map((a): unknown => a['action']);
    for (const action of ['auth.register', 'auth.login', 'auth.step_up', 'auth.logout']) {
      expect(actions).toContain(action);
    }
  });

  it('Super Admin (bootstrap invite): 12 h cookie; ★ routes need the step-up, which opens a 5-minute window', async () => {
    const { inviteUrl } = await bootstrapSuperAdminInvite(h(), {
      displayName: 'Test Owner',
      uiLocale: 'en',
      force: true,
      adminOrigin: ORIGIN,
      pepper,
      now: clock.now(),
    });
    const token = new URL(inviteUrl).hash.slice(1);
    const { credential, res, cookie } = await register(token);
    expect(setCookies(res).find((c) => c.startsWith('__Host-mc_sess='))).toMatch(/Max-Age=43200;/);
    const star = (c: string) => request(app()).get('/api/admin/probe/step-up').set('Cookie', c);
    expect((await star(cookie)).body).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    const stepped = await stepUp(cookie, credential);
    expect(stepped.res.status).toBe(204);
    expect((await star(stepped.cookie)).status).toBe(200);
    clock.advance(5 * 60 * 1000 + 1000);
    expect((await star(stepped.cookie)).body).toMatchObject({ code: 'STEP_UP_REQUIRED' });
  });
});

// --- invites -------------------------------------------------------------------------------------------------------

describe('invites: reuse, expiry, unknown — all the same failure', () => {
  it('a used invite gives no options (uniform 404) and cannot register a second passkey', async () => {
    const { token } = await invitedAdmin();
    const first = await registerOptions(token);
    if (!first.options) throw new Error('no options');
    const second = authenticator.create(first.options); // prepared from the same options, before the first completes
    await register(token);
    const again = await registerOptions(token);
    expect(again.res.status).toBe(404);
    expect(again.res.body).toMatchObject({ code: 'INVITE_INVALID' });
    const reuse = await request(app())
      .post('/api/admin/auth/register/verify')
      .set(CSRF)
      .send({ inviteToken: token, response: second.response, label: 'Second' });
    expect(reuse.status).toBe(401); // its challenge was used up by the first registration
    expect(await raw('webauthn_credentials').countDocuments({ label: 'Second' })).toBe(0);
  });

  it('expired and unknown invites: the same 404 as a used one', async () => {
    const { token } = await invitedAdmin();
    clock.advance(73 * 60 * 60 * 1000); // invites live 72 h
    const expired = await registerOptions(token);
    const unknown = await registerOptions(newToken());
    for (const r of [expired.res, unknown.res]) {
      expect(r.status).toBe(404);
      expect(r.body).toMatchObject({ code: 'INVITE_INVALID' });
    }
    // Identical apart from the request id: nothing tells an expired invite from one that never existed.
    const withoutId = (body: unknown) => ({ ...z.object({}).loose().parse(body), requestId: undefined });
    expect(withoutId(expired.res.body)).toEqual(withoutId(unknown.res.body));
  });

  it('the invite is checked again inside the registration transaction (expired between options and verify)', async () => {
    const { token } = await invitedAdmin();
    clock.advance(72 * 60 * 60 * 1000 - 60_000); // one minute before the invite expires
    const { options } = await registerOptions(token);
    if (!options) throw new Error('no options');
    clock.advance(2 * 60_000); // the invite has expired, the 5-minute challenge has not
    const res = await request(app())
      .post('/api/admin/auth/register/verify')
      .set(CSRF)
      .send({ inviteToken: token, response: authenticator.create(options).response, label: 'Late' });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'INVITE_INVALID' });
  });
});

// --- verification failures -----------------------------------------------------------------------------------------

describe('registration verification (04 §3)', () => {
  it('wrong origin, wrong RP ID, uv=false, foreign challenge: 401, nothing stored, the invite stays usable', async () => {
    const { token } = await invitedAdmin();
    const other = await invitedAdmin();
    const otherOptions = (await registerOptions(other.token)).options;
    if (!otherOptions) throw new Error('no options');
    const cases = [
      [{ origin: 'https://evil.test' }, /origin/],
      [{ rpId: 'evil.test' }, /RP ID/],
      [{ uv: false }, /User verification (was )?required/],
      [{ challenge: otherOptions.challenge }, /challenge/], // a challenge issued for another invite
    ] as const;
    for (const [o, reason] of cases) {
      const { options } = await registerOptions(token);
      if (!options) throw new Error('no options');
      const res = await request(app())
        .post('/api/admin/auth/register/verify')
        .set(CSRF)
        .send({ inviteToken: token, response: authenticator.create(options, o).response, label: 'Bad' });
      expect(res.status, JSON.stringify(o)).toBe(401);
      expect(res.body).toMatchObject({ code: 'PASSKEY_FAILED' });
      expect(lastReason()).toMatch(reason);
    }
    expect(await raw('webauthn_credentials').countDocuments({ label: 'Bad' })).toBe(0);
    await register(token); // still works
  });

  it('a credential that is already registered (to anyone) is refused; the invite is not used up', async () => {
    const first = await register((await invitedAdmin()).token);
    const { token, adminId } = await invitedAdmin();
    const { options } = await registerOptions(token);
    if (!options) throw new Error('no options');
    const res = await request(app())
      .post('/api/admin/auth/register/verify')
      .set(CSRF)
      .send({
        inviteToken: token,
        response: authenticator.create(options, { same: first.credential }).response,
        label: 'Dup',
      });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'PASSKEY_FAILED' });
    expect(await raw('webauthn_credentials').countDocuments({ admin_id: adminId })).toBe(0);
    expect(await raw('admin_sessions').countDocuments({ admin_id: adminId })).toBe(0); // one transaction, rolled back
    expect((await registerOptions(token)).res.status).toBe(200); // the invite is still open
  });

  it('a real authenticator model id (AAGUID) is stored', async () => {
    const { token, adminId } = await invitedAdmin();
    const { options } = await registerOptions(token);
    if (!options) throw new Error('no options');
    const aaguid = Buffer.from('ea9b8d664d011d213ce4b6b48cb575d4', 'hex');
    const res = await request(app())
      .post('/api/admin/auth/register/verify')
      .set(CSRF)
      .send({ inviteToken: token, response: authenticator.create(options, { aaguid }).response, label: 'Model' });
    expect(res.status).toBe(204);
    const stored = await raw('webauthn_credentials').findOne({ admin_id: adminId });
    const value: unknown = stored?.['aaguid'];
    expect(isId(value) ? idText(value) : value).toBe('ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4');
  });

  it('a replayed registration response is refused (the challenge was deleted on first use)', async () => {
    const { token } = await invitedAdmin();
    const { options } = await registerOptions(token);
    if (!options) throw new Error('no options');
    const { response } = authenticator.create(options, { uv: false });
    const send = () =>
      request(app())
        .post('/api/admin/auth/register/verify')
        .set(CSRF)
        .send({ inviteToken: token, response, label: 'x' });
    expect((await send()).status).toBe(401);
    expect((await send()).status).toBe(401);
  });
});

describe('login verification (04 §3)', () => {
  it('replay, expired challenge, missing challenge cookie, wrong origin / RP ID, uv=false, bad signature: 401', async () => {
    const { token } = await invitedAdmin();
    const { credential } = await register(token);
    const before = await failedLogins();

    const ok = await login(credential);
    expect(ok.res.status).toBe(204);
    const replay = await request(app())
      .post('/api/admin/auth/login/verify')
      .set(CSRF)
      .set('Cookie', ok.challengeCookie)
      .send({ response: ok.response });
    expect(replay.status).toBe(401);

    const late = await loginOptions();
    clock.advance((CHALLENGE_TTL_SEC + 1) * 1000);
    const expired = await request(app())
      .post('/api/admin/auth/login/verify')
      .set(CSRF)
      .set('Cookie', late.challengeCookie)
      .send({ response: authenticator.get(late.options, credential) });
    expect(expired.status).toBe(401);

    const noCookie = await loginOptions();
    const withoutCookie = await request(app())
      .post('/api/admin/auth/login/verify')
      .set(CSRF)
      .send({ response: authenticator.get(noCookie.options, credential) });
    expect(withoutCookie.status).toBe(401);

    const cases = [
      [{ origin: 'https://evil.test' }, /origin/],
      [{ rpId: 'evil.test' }, /RP ID/],
      [{ uv: false }, /User verification (was )?required/],
      [{ badSignature: true }, /not verified/],
    ] as const;
    for (const [o, reason] of cases) {
      const attempt = await login(credential, o);
      expect(attempt.res.status, JSON.stringify(o)).toBe(401);
      expect(attempt.res.body).toMatchObject({ code: 'PASSKEY_FAILED' });
      expect(lastReason()).toMatch(reason);
    }
    expect(await failedLogins()).toBe(before + 7);
    expect((await login(credential)).res.status).toBe(204); // the credential still works
  });

  it('unknown credential and foreign / missing user handle: the same 401; failures audited by hash only', async () => {
    const { token } = await invitedAdmin();
    const { credential } = await register(token);
    const stranger = authenticator.create(
      creationOptionsSchema.parse((await registerOptions((await invitedAdmin()).token)).res.body),
    ).credential; // never registered
    const attempts = [
      [() => login(stranger), /unknown or revoked credential/],
      [() => login(credential, { userHandle: randomBytes(32) }), /user handle/],
      [() => login(credential, { userHandle: null }), /user handle/],
    ] as const;
    for (const [attempt, reason] of attempts) {
      const { res } = await attempt();
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: 'PASSKEY_FAILED' });
      expect(lastReason()).toMatch(reason);
    }
    const audit = await raw('audit_log').find({ action: 'auth.login_failed' }).sort({ _id: -1 }).limit(1).next();
    expect(audit?.['actor_type']).toBe('system');
    expect(Object.keys((audit?.['meta'] as Record<string, unknown> | undefined) ?? {})).toEqual(['credential_hash']);
    expect(audit).not.toHaveProperty('target_id');
  });

  it('a sign counter going backwards revokes the credential and all sessions of the admin (possible clone)', async () => {
    const { token, adminId } = await invitedAdmin();
    const alerts = async () =>
      (await getDashboard(h(), superScope(newId(), clock.now()), { now: clock.now() })).passkeyAlerts;
    const alertsBefore = await alerts();
    const { credential, cookie } = await register(token);
    credential.counter = 5;
    expect((await login(credential)).res.status).toBe(204);
    credential.counter = 3;
    const clone = await login(credential);
    expect(clone.res.status).toBe(401);
    expect(await raw('webauthn_credentials').countDocuments({ admin_id: adminId, revoked_at: { $exists: true } })).toBe(
      1,
    );
    expect((await me(cookie)).status).toBe(401); // the registration session is revoked too
    credential.counter = 9;
    expect((await login(credential)).res.status).toBe(401); // revoked for good
    expect(await alerts()).toBe(alertsBefore + 1); // C1 dashboard flag (the push alert is Phase 4)
    expect(
      log.lines().some((l) => l['event'] === 'passkey.counter_regression' && typeof l['credential'] === 'string'),
    ).toBe(true);
  });

  it('a FORGED assertion with a low counter does not revoke anything (the rule runs only after the signature)', async () => {
    const { token, adminId } = await invitedAdmin();
    const { credential } = await register(token);
    credential.counter = 5;
    expect((await login(credential)).res.status).toBe(204);
    credential.counter = 1;
    expect((await login(credential, { badSignature: true })).res.status).toBe(401);
    expect(await raw('webauthn_credentials').countDocuments({ admin_id: adminId, revoked_at: { $exists: true } })).toBe(
      0,
    );
    credential.counter = 6;
    expect((await login(credential)).res.status).toBe(204);
  });
});

describe('step-up (03 §4)', () => {
  it('only with the signed-in admin’s own passkey; a login challenge cannot be used for it; needs a session', async () => {
    const a = await register((await invitedAdmin()).token);
    const b = await register((await invitedAdmin()).token);
    const withOthers = await stepUp(a.cookie, b.credential);
    expect(withOthers.res.status).toBe(401);
    expect(lastReason()).toMatch(/another admin/);
    expect((await me(a.cookie)).status).toBe(200); // a's session is untouched

    // A challenge issued for login, signed and sent to step-up (purpose binding).
    const { options } = await loginOptions();
    await request(app()).post('/api/admin/auth/step-up/options').set(CSRF).set('Cookie', a.cookie);
    const crossed = await request(app())
      .post('/api/admin/auth/step-up/verify')
      .set(CSRF)
      .set('Cookie', a.cookie)
      .send({ response: authenticator.get(options, a.credential) });
    expect(crossed.status).toBe(401);
    expect(lastReason()).toMatch(/challenge/);

    const anonymous = await request(app()).post('/api/admin/auth/step-up/options').set(CSRF);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({ code: 'SESSION_REQUIRED' });
    expect((await stepUp(a.cookie, a.credential)).res.status).toBe(204);
  });
});

describe('CSRF guard (03 §1) on the passkey routes', () => {
  it('missing X-MC-CSRF or a foreign Origin → 403 before anything else', async () => {
    for (const path of ['register/options', 'register/verify', 'login/options', 'login/verify', 'step-up/options']) {
      const noHeader = await request(app()).post(`/api/admin/auth/${path}`).set('Origin', ORIGIN).send({});
      const foreign = await request(app())
        .post(`/api/admin/auth/${path}`)
        .set({ Origin: 'https://evil.test', 'X-MC-CSRF': '1' })
        .send({});
      expect(noHeader.status, path).toBe(403);
      expect(foreign.status, path).toBe(403);
    }
  });
});

describe('logs', () => {
  it('never contain challenges, invite tokens, credential ids or the session cookie', async () => {
    const { token } = await invitedAdmin();
    const { options } = await registerOptions(token);
    if (!options) throw new Error('no options');
    const created = authenticator.create(options);
    const res = await request(app())
      .post('/api/admin/auth/register/verify')
      .set(CSRF)
      .send({ inviteToken: token, response: created.response, label: 'Logged' });
    const sessionToken = cookieValue(res, '__Host-mc_sess') ?? 'missing';
    const failed = await login(created.credential, { uv: false });
    const text = JSON.stringify(log.lines());
    for (const secret of [
      token,
      options.challenge,
      created.response.id,
      sessionToken,
      failed.response.response.signature,
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('e2e seed hook (test-hook mode only, 10 §3)', () => {
  it('POST /test/super-admin-invite makes a Super Admin invite that registers through the real routes', async () => {
    const hookApp = createAdminApp({
      logger: log.logger,
      release: 't',
      trustedProxyMode: 'none',
      adminOrigin: ORIGIN,
      clock,
      rateLimiter: memoryRateLimiter(),
      authenticate: sessionAuthenticator({ db: h(), pepper, clock }),
      routes: [...adminSessionRoutes({ db: h(), pepper, adminOrigin: ORIGIN })],
      testRoutes: testHookRoutes({
        service: 'api-admin',
        clock: new ShiftableClock(() => clock.now().getTime()),
        admin: { db: h(), pepper, adminOrigin: ORIGIN },
      }),
    }).app;
    const path = '/api/admin/test/super-admin-invite';
    expect((await request(hookApp).post(path).send({ displayName: 'E2E Owner' })).status).toBe(403); // CSRF guard
    const created = await request(hookApp).post(path).set(CSRF).send({ displayName: 'E2E Owner' });
    expect(created.status).toBe(201);
    const url = new URL(z.object({ inviteUrl: z.url() }).parse(created.body).inviteUrl);
    expect(`${url.origin}${url.pathname}`).toBe(`${ORIGIN}/invite`);
    const token = url.hash.slice(1);
    const invite = await request(hookApp).get(`/api/admin/auth/invite/${token}`);
    expect(invite.body).toMatchObject({ adminDisplayName: 'E2E Owner', purpose: 'register' });
    const { cookie } = await register(token);
    expect((await me(cookie)).body).toMatchObject({ admin: { displayName: 'E2E Owner', role: 'super_admin' } });
  });
});
