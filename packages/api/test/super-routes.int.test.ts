// PHASE_01 T1.11 (API) against a migrated MongoDB: the /api/super role guard for every route (and unknown paths), ★
// step-up, the onboarding flow (passkey registration itself through the data layer until the WebAuthn routes land),
// audit actors/targets, the audited phone view, CSV export without formula injection, settings, and
// UNDERTAKING_REQUIRED for masjid-admin writes.
import { randomBytes } from 'node:crypto';

import { type DbHandle, idText, isId, publicScope } from '@mc/db';
import { runMigrations } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';
import { registerCredential } from '@mc/db/state';
import { createTestDatabase, processUserHandle, type TestDatabase } from '@mc/db/testing';
import { ManualClock } from '@mc/shared/clock';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createAdminApp } from '../src/app.ts';
import { sessionAuthenticator } from '../src/auth/session.ts';
import { type FieldKeyRing, hashToken, newToken } from '../src/crypto/field.ts';
import { defineRoute } from '../src/http/define-route.ts';
import { memoryRateLimiter } from '../src/http/rate-limit.ts';
import { bootstrapSuperAdminInvite } from '../src/jobs/bootstrap-super-admin.ts';
import { adminRoutes } from '../src/routes/index.ts';
import { AUDIT_EXPORT_MAX_ROWS } from '../src/routes/super.ts';
import { passkeyDeps, silentLogger } from './helpers.ts';

const ORIGIN = 'https://admin.test';
const CSRF = { Origin: ORIGIN, 'X-MC-CSRF': '1' };
const pepper = randomBytes(32);
const keyRing: FieldKeyRing = { currentId: 'k1', keys: new Map([['k1', randomBytes(32)]]) };
const clock = new ManualClock(new Date('2026-10-16T08:00:00Z'));

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

const writeProbe = defineRoute({
  method: 'post',
  path: '/probe/write',
  summary: 'a masjid-admin write',
  auth: 'session',
  responses: { 204: z.object({}) },
  handler: ({ reply }) => reply(204, {}),
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
    ...(() => {
      const built = adminRoutes({ db: h(), pepper, adminOrigin: ORIGIN, keyRing, ...passkeyDeps(ORIGIN, clock) });
      return { routes: [...built.routes, writeProbe], superRoutes: built.superRoutes };
    })(),
  }).app;

/** Registers a passkey for an invite link's token (data layer) and returns the session cookie. */
async function register(inviteUrlText: string): Promise<{ cookie: string; sessionId: string }> {
  const token = new URL(inviteUrlText).hash.slice(1);
  const sessionToken = newToken();
  const result = await registerCredential(h(), publicScope(), {
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
  return { cookie: `__Host-mc_sess=${sessionToken}`, sessionId: result.sessionId.toHexString() };
}

let superCookie = '';
const stepUp = async () =>
  t()
    .db.collection<{ token_hash: Buffer; step_up_at: Date }>('admin_sessions')
    .updateOne(
      { token_hash: hashToken(superCookie.split('=')[1] ?? '', pepper) },
      { $set: { step_up_at: clock.now() } },
    );
const asSuper = (method: 'get' | 'post' | 'patch' | 'delete', path: string) => {
  const call = request(app())[method](`/api/super${path}`).set('Cookie', superCookie);
  return method === 'get' ? call : call.set(CSRF);
};

beforeAll(async () => {
  test = await createTestDatabase('super_routes');
  await runMigrations(test.db, MIGRATIONS);
  // As api-admin's own database user (02 §4.3), like on the servers — a missing privilege fails here.
  asAdmin = await processUserHandle(test, 'mc_admin');
  handle = asAdmin.handle;
  const { inviteUrl } = await bootstrapSuperAdminInvite(h(), {
    displayName: 'Test Owner',
    uiLocale: 'en',
    force: false,
    adminOrigin: ORIGIN,
    pepper,
    now: clock.now(),
  });
  ({ cookie: superCookie } = await register(inviteUrl));
});

afterAll(async () => {
  await asAdmin?.dispose();
  await test?.dispose();
});

const MASJID = {
  name: 'Test Masjid Epsilon',
  area: 'Test Area',
  city: 'Hyderabad',
  state: 'Telangana',
  address: 'Test address',
  lat: 17.385,
  lng: 78.4867,
};

describe('concurrent api-admin requests (02 §4: scopes per request, never shared)', () => {
  it('24 interleaved requests from admins of two masjids: each sees only its own admin, masjid, sessions and passkeys', async () => {
    const adminOf = async (name: string) => {
      const masjid = await asSuper('post', '/masjids').send({ ...MASJID, name });
      const masjidId = (masjid.body as { id: string }).id;
      const admin = await asSuper('post', '/admins').send({
        displayName: `Admin of ${name}`,
        uiLocale: 'en',
        masjidId,
        role: 'owner',
      });
      const { cookie, sessionId } = await register((admin.body as { inviteUrl: string }).inviteUrl);
      const me = await request(app()).get('/api/admin/auth/me').set('Cookie', cookie);
      const adminId = (me.body as { admin: { id: string } }).admin.id;
      return { masjidId, adminId, cookie, sessionId };
    };
    const a = await adminOf('Test Masjid Concurrent A');
    const b = await adminOf('Test Masjid Concurrent B');
    const calls = Array.from({ length: 24 }, (_, i) => {
      const who = i % 2 === 0 ? a : b;
      const path = ['/auth/me', '/auth/sessions', '/auth/passkeys'][i % 3] ?? '/auth/me';
      return { who, path, response: request(app()).get(`/api/admin${path}`).set('Cookie', who.cookie) };
    });
    const responses = await Promise.all(calls.map(async (call) => ({ ...call, response: await call.response })));
    for (const { who, path, response } of responses) {
      const other = who === a ? b : a;
      expect(response.status, path).toBe(200);
      const text = JSON.stringify(response.body);
      for (const foreign of [other.adminId, other.masjidId, other.sessionId]) expect(text, path).not.toContain(foreign);
      if (path === '/auth/me') {
        expect(response.body).toMatchObject({ admin: { id: who.adminId }, masjids: [{ id: who.masjidId }] });
      }
      if (path === '/auth/sessions') {
        expect(response.body).toMatchObject({ sessions: [{ id: who.sessionId, current: true }] });
      }
    }
  });
});

describe('/api/super role guard (04 §5)', () => {
  it('no session → 401 on every super route; a masjid admin → 403 on every route and unknown paths', async () => {
    const created = await asSuper('post', '/masjids').send(MASJID);
    const masjidId = (created.body as { id: string }).id;
    const admin = await asSuper('post', '/admins').send({
      displayName: 'Test Admin',
      uiLocale: 'en',
      masjidId,
      role: 'owner',
    });
    const { cookie } = await register((admin.body as { inviteUrl: string }).inviteUrl);
    const id = '8f14e45f-ceea-467a-9a1b-2b3c4d5e6f70';
    const routes: ['get' | 'post' | 'patch' | 'delete', string][] = [
      ['get', '/dashboard'],
      ['get', '/masjids'],
      ['post', '/masjids'],
      ['get', `/masjids/${id}`],
      ['patch', `/masjids/${id}`],
      ['patch', `/masjids/${id}/quotas`],
      ['post', `/masjids/${id}/activate`],
      ['post', `/masjids/${id}/suspend`],
      ['post', `/masjids/${id}/unsuspend`],
      ['delete', `/masjids/${id}`],
      ['post', '/admins'],
      ['get', `/admins?masjidId=${id}`],
      ['post', `/admins/${id}/invites`],
      ['post', `/admins/${id}/revoke-sessions`],
      ['post', `/admins/${id}/revoke-passkeys`],
      ['delete', `/admins/${id}/masjids/${id}`],
      ['get', `/admins/${id}/phone`],
      ['get', '/settings'],
      ['patch', '/settings'],
      ['get', '/audit'],
      ['get', '/audit/export.csv'],
      ['get', '/no-such-route'],
    ];
    for (const [method, path] of routes) {
      const anonymous = await request(app())[method](`/api/super${path}`).set(CSRF);
      expect(anonymous.status, `${method} ${path}`).toBe(401);
      const asAdmin = await request(app())[method](`/api/super${path}`).set(CSRF).set('Cookie', cookie);
      expect(asAdmin.status, `${method} ${path}`).toBe(403);
      expect((asAdmin.body as { code: string }).code).toBe('FORBIDDEN');
    }
  });
});

describe('onboarding (T1.11 acceptance, API level)', () => {
  it('create masjid → create admin → invite → register → undertaking → activate → publicly visible; all audited', async () => {
    const created = await asSuper('post', '/masjids').send({ ...MASJID, nameI18n: { ur: 'ٹیسٹ مسجد' } });
    expect(created.status).toBe(201);
    const { id: masjidId, followCode } = created.body as { id: string; followCode: string };
    expect(followCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);

    const notReady = await asSuper('post', `/masjids/${masjidId}/activate`);
    expect(notReady.body).toMatchObject({ status: 409, code: 'ACTIVATION_REQUIREMENTS' });

    const admin = await asSuper('post', '/admins').send({
      displayName: 'Test Imam',
      phone: '+919848022338',
      uiLocale: 'ur',
      masjidId,
      role: 'owner',
    });
    expect(admin.status).toBe(201);
    const { inviteUrl, adminId } = admin.body as { inviteUrl: string; adminId: string };
    expect(inviteUrl.startsWith(`${ORIGIN}/invite#`)).toBe(true);
    const token = new URL(inviteUrl).hash.slice(1);
    const invite = await request(app()).get(`/api/admin/auth/invite/${token}`);
    expect(invite.body).toMatchObject({
      adminDisplayName: 'Test Imam',
      masjidNames: ['Test Masjid Epsilon'],
      uiLocale: 'ur',
    });

    const { cookie } = await register(inviteUrl);
    const me = await request(app()).get('/api/admin/auth/me').set('Cookie', cookie);
    expect(me.body).toMatchObject({ undertakingRequired: true, masjids: [{ id: masjidId, role: 'owner' }] });
    // Writes are refused until the undertaking is accepted; logout etc. stay possible.
    expect((await request(app()).post('/api/admin/probe/write').set(CSRF).set('Cookie', cookie)).body).toMatchObject({
      code: 'UNDERTAKING_REQUIRED',
    });
    const settings = await asSuper('get', '/settings');
    const version = (settings.body as { undertakingVersion: string }).undertakingVersion;
    expect(
      (
        await request(app())
          .post('/api/admin/auth/undertaking')
          .set(CSRF)
          .set('Cookie', cookie)
          .send({ version: 'stale' })
      ).body,
    ).toMatchObject({ code: 'UNDERTAKING_VERSION_MISMATCH' });
    expect(
      (await request(app()).post('/api/admin/auth/undertaking').set(CSRF).set('Cookie', cookie).send({ version }))
        .status,
    ).toBe(204);
    expect((await request(app()).post('/api/admin/probe/write').set(CSRF).set('Cookie', cookie)).status).toBe(204);

    expect((await asSuper('post', `/masjids/${masjidId}/activate`)).status).toBe(204);
    const detail = await asSuper('get', `/masjids/${masjidId}`);
    expect(detail.body).toMatchObject({
      masjid: { status: 'active', nameI18n: { ur: 'ٹیسٹ مسجد' }, adminCount: 1 },
      admins: [
        { id: adminId, displayName: 'Test Imam', status: 'active', hasPhone: true, undertakingVersion: version },
      ],
    });
    expect(JSON.stringify(detail.body)).not.toContain('9848022338');
    const visible = await t().db.collection('v_pub_masjids').countDocuments({ follow_code: followCode });
    expect(visible).toBe(1);

    const audit = await asSuper('get', `/audit?masjid=${masjidId}`);
    const actions = (audit.body as { entries: { action: string; actorType: string }[] }).entries.map(
      (e) => `${e.actorType}:${e.action}`,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        'super_admin:masjid.create',
        'super_admin:admin.add_to_masjid',
        'super_admin:masjid.activate',
      ]),
    );
    const adminAudit = await asSuper('get', `/audit?actor=${adminId}`);
    expect((adminAudit.body as { entries: { action: string }[] }).entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(['auth.register', 'invite.consume', 'admin.undertaking_accept']),
    );
  });
});

describe('★ step-up routes', () => {
  it('refused without a recent passkey assertion; phone view decrypts and is audited; suspend needs a reason', async () => {
    const created = await asSuper('post', '/masjids').send(MASJID);
    const masjidId = (created.body as { id: string }).id;
    const admin = await asSuper('post', '/admins').send({
      displayName: 'Test Admin',
      phone: '+919000000001',
      uiLocale: 'te',
      masjidId,
      role: 'editor',
    });
    const { adminId } = admin.body as { adminId: string };
    clock.advance(10 * 60_000);
    expect((await asSuper('get', `/admins/${adminId}/phone`)).body).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    expect((await asSuper('post', `/admins/${adminId}/revoke-sessions`)).body).toMatchObject({
      code: 'STEP_UP_REQUIRED',
    });
    await stepUp();
    const phone = await asSuper('get', `/admins/${adminId}/phone`).set('X-Request-Id', 'phone-view-0001');
    expect(phone.body).toEqual({ phone: '+919000000001' });
    const entries = await asSuper('get', '/audit?action=admin.phone_view');
    expect((entries.body as { entries: { requestId?: string; targetId?: string }[] }).entries[0]).toMatchObject({
      requestId: 'phone-view-0001',
    });
    expect((await asSuper('post', `/masjids/${masjidId}/suspend`).send({})).status).toBe(400);
    const listed = await asSuper('get', `/admins?masjidId=${masjidId}`);
    expect(listed.body).toMatchObject({ admins: [{ id: adminId, role: 'editor', uiLocale: 'te', hasPhone: true }] });
    expect((await asSuper('get', '/admins?masjidId=8f14e45f-ceea-467a-9a1b-2b3c4d5e6f70')).body).toMatchObject({
      code: 'MASJID_NOT_FOUND',
    });
    expect((await asSuper('get', '/masjids/8f14e45f-ceea-467a-9a1b-2b3c4d5e6f70')).status).toBe(404);
    expect((await asSuper('post', `/admins/${adminId}/revoke-passkeys`)).body).toEqual({ count: 0 });
    const reinvite = await asSuper('post', `/admins/${adminId}/invites`).send({ purpose: 'recovery' });
    expect(reinvite.status).toBe(201);
    expect((await asSuper('post', `/admins/${adminId}/revoke-sessions`)).body).toEqual({ count: 0 });
    expect((await asSuper('delete', `/admins/${adminId}/masjids/${masjidId}`)).status).toBe(204);
    expect((await asSuper('delete', `/admins/${adminId}/masjids/${masjidId}`)).body).toMatchObject({
      code: 'NOT_MEMBER',
    });
    expect((await asSuper('get', '/admins/not-an-id/phone')).body).toMatchObject({ code: 'ADMIN_NOT_FOUND' });
  });
});

describe('masjid edits, settings, CSV export', () => {
  it('PATCH validates (India only, allow-listed fields) and bumps; quotas; settings round trip', async () => {
    const created = await asSuper('post', '/masjids').send(MASJID);
    const masjidId = (created.body as { id: string }).id;
    expect((await asSuper('post', '/masjids').send({ ...MASJID, lat: 51.5 })).status).toBe(400);
    expect((await asSuper('patch', `/masjids/${masjidId}`).send({ status: 'active' })).status).toBe(400);
    const withOffset = await asSuper('post', '/masjids').send({ ...MASJID, hijriOffset: 1, nameI18n: { hi: 'टेस्ट' } });
    const offsetId = (withOffset.body as { id: string }).id;
    expect((await asSuper('get', `/masjids/${offsetId}`)).body).toMatchObject({
      masjid: { hijriOffset: 1, nameI18n: { hi: 'टेस्ट' } },
    });
    expect((await asSuper('patch', `/masjids/${offsetId}`).send({ nameI18n: { te: 'టెస్ట్' } })).body).toEqual({
      changed: ['name_i18n'],
    });
    const edited = await asSuper('patch', `/masjids/${masjidId}`).send({ area: 'New Area', hijriOffset: null });
    expect(edited.body).toEqual({ changed: ['area', 'hijri_offset'] });
    expect((await asSuper('patch', `/masjids/${masjidId}`).send({})).body).toMatchObject({ code: 'NOTHING_TO_UPDATE' });
    expect((await asSuper('patch', `/masjids/${masjidId}/quotas`).send({ pushDailyQuota: 51 })).status).toBe(400);
    expect((await asSuper('patch', `/masjids/${masjidId}/quotas`).send({ pushDailyQuota: 3 })).body).toEqual({
      changed: ['push_daily_quota'],
    });
    const list = await asSuper('get', '/masjids?q=epsilon&status=pending');
    expect((list.body as { masjids: unknown[] }).masjids.length).toBeGreaterThan(0);
    expect((await asSuper('patch', '/settings').send({ defaultPushQuota: 7 })).body).toEqual({
      changed: ['default_push_quota'],
    });
    expect((await asSuper('get', '/settings')).body).toMatchObject({ defaultPushQuota: 7 });
    expect((await asSuper('get', '/dashboard')).body).toMatchObject({
      counts: { pending: expect.any(Number) as unknown },
      passkeyAlerts: 0,
    });
  });

  it('CSV export (★): attachment, header row, formula-leading cells neutralised', async () => {
    await asSuper('post', '/masjids').send({ ...MASJID, name: '=HYPERLINK("https://evil.test","x")' });
    await stepUp();
    const csv = await asSuper('get', '/audit/export.csv?action=masjid.create');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/^text\/csv/);
    expect(csv.headers['content-disposition']).toBe('attachment; filename="audit.csv"');
    const lines = csv.text.trim().split('\r\n');
    expect(lines[0]).toBe('at,actor_type,actor_id,action,masjid_id,target_type,target_id,meta,request_id');
    expect(csv.text).not.toMatch(/(^|,)"=/m);
    expect(csv.text).toContain('"masjid.create"');
    // The export is audited itself (review L9): filters and row count, never the rows.
    const exported = await t()
      .db.collection('audit_log')
      .find({ action: 'audit.export' })
      .sort({ _id: -1 })
      .limit(1)
      .next();
    expect(exported?.['meta']).toEqual({ filters: { action: 'masjid.create' }, rows: lines.length - 1 });
  });

  it('CSV export stops at exactly 10 000 rows (review L-12)', async () => {
    const at = clock.now();
    await t()
      .db.collection('audit_log')
      .insertMany(
        Array.from({ length: AUDIT_EXPORT_MAX_ROWS + 150 }, () => ({
          at,
          actor_type: 'system',
          action: 'auth.logout',
        })),
      );
    await stepUp();
    const csv = await asSuper('get', '/audit/export.csv?action=auth.logout');
    expect(csv.status).toBe(200);
    expect(csv.text.trim().split('\r\n')).toHaveLength(AUDIT_EXPORT_MAX_ROWS + 1); // + the header line
  });
});

describe('audit trail of every T1.11 action (phase-verifier 22 Oct 2026)', () => {
  it('each Super Admin action writes its entry with the Super Admin as actor and the right target', async () => {
    const superId = (
      (await request(app()).get('/api/admin/auth/me').set('Cookie', superCookie)).body as {
        admin: { id: string };
      }
    ).admin.id;
    let n = 0;
    const tagged = (method: 'get' | 'post' | 'patch' | 'delete', path: string) => {
      n += 1;
      const requestId = `t111-audit-${String(n).padStart(4, '0')}`;
      return { requestId, call: asSuper(method, path).set('X-Request-Id', requestId) };
    };
    const expected: { requestId: string; action: string; target?: string; masjid?: string }[] = [];
    const run = async (
      method: 'get' | 'post' | 'patch' | 'delete',
      path: string,
      body: object | undefined,
      entries: { action: string; target?: string; masjid?: string }[],
    ) => {
      const { requestId, call } = tagged(method, path);
      const response = await (body === undefined ? call : call.send(body));
      expect(response.status, `${method} ${path}`).toBeLessThan(300);
      for (const entry of entries) expected.push({ requestId, ...entry });
      return response;
    };

    const created = await run('post', '/masjids', MASJID, [{ action: 'masjid.create' }]);
    const masjidId = (created.body as { id: string }).id;
    expected.forEach((e) => Object.assign(e, { target: masjidId, masjid: masjidId }));
    await run('patch', `/masjids/${masjidId}`, { area: 'Audit Area' }, [
      { action: 'masjid.update', target: masjidId, masjid: masjidId },
    ]);
    await run('patch', `/masjids/${masjidId}/quotas`, { pushDailyQuota: 4 }, [
      { action: 'masjid.update', target: masjidId, masjid: masjidId },
    ]);
    const admin = await asSuper('post', '/admins')
      .set('X-Request-Id', 't111-audit-admin')
      .send({ displayName: 'Test Audit Admin', phone: '+919000000002', uiLocale: 'en', masjidId, role: 'owner' });
    const { adminId, inviteUrl } = admin.body as { adminId: string; inviteUrl: string };
    for (const action of ['admin.create', 'admin.add_to_masjid', 'admin.invite']) {
      expected.push({ requestId: 't111-audit-admin', action, target: adminId });
    }
    const { cookie } = await register(inviteUrl);
    const version = ((await asSuper('get', '/settings')).body as { undertakingVersion: string }).undertakingVersion;
    await request(app()).post('/api/admin/auth/undertaking').set(CSRF).set('Cookie', cookie).send({ version });
    await run('post', `/masjids/${masjidId}/activate`, undefined, [
      { action: 'masjid.activate', target: masjidId, masjid: masjidId },
    ]);
    await stepUp();
    await run('post', `/admins/${adminId}/invites`, { purpose: 'recovery' }, [
      { action: 'admin.invite', target: adminId },
    ]);
    await run('get', `/admins/${adminId}/phone`, undefined, [{ action: 'admin.phone_view', target: adminId }]);
    await run('post', `/admins/${adminId}/revoke-sessions`, undefined, [{ action: 'session.revoke', target: adminId }]);
    await run('post', `/admins/${adminId}/revoke-passkeys`, undefined, [
      { action: 'credential.revoke', target: adminId },
    ]);
    await run('post', `/masjids/${masjidId}/suspend`, { reason: 'Test suspension reason' }, [
      { action: 'masjid.suspend', target: masjidId, masjid: masjidId },
    ]);
    await run('post', `/masjids/${masjidId}/unsuspend`, { reason: 'Test unsuspension reason' }, [
      { action: 'masjid.unsuspend', target: masjidId, masjid: masjidId },
    ]);
    await run('delete', `/admins/${adminId}/masjids/${masjidId}`, undefined, [
      { action: 'admin.remove_from_masjid', target: adminId, masjid: masjidId },
    ]);
    await run('delete', `/masjids/${masjidId}`, { reason: 'Test deletion reason' }, [
      { action: 'masjid.delete', target: masjidId, masjid: masjidId },
    ]);
    await run('patch', '/settings', { defaultPushQuota: 5 }, [{ action: 'settings.update', target: 'global' }]);
    await run('get', '/audit/export.csv?action=settings.update', undefined, [{ action: 'audit.export' }]);

    const plain = (id: string | undefined) => id?.replaceAll('-', '').toLowerCase();
    const rows = await t()
      .db.collection<{ request_id?: string } & Record<string, unknown>>('audit_log')
      .find({ request_id: { $in: [...new Set(expected.map((e) => e.requestId))] } })
      .toArray();
    const text = (value: unknown) => plain(isId(value) ? idText(value) : typeof value === 'string' ? value : undefined);
    for (const e of expected) {
      const row = rows.find((r) => r.request_id === e.requestId && r['action'] === e.action);
      expect(row, `${e.action} (${e.requestId}) audited`).toBeDefined();
      expect(row?.['actor_type'], e.action).toBe('super_admin');
      expect(text(row?.['actor_id']), `${e.action} actor`).toBe(plain(superId));
      if (e.target) expect(text(row?.['target_id']), `${e.action} target`).toBe(plain(e.target));
      else expect(row?.['target_id'], `${e.action} has no target`).toBeUndefined();
      if (e.masjid) expect(text(row?.['masjid_id']), `${e.action} masjid`).toBe(plain(e.masjid));
    }
  });
});
