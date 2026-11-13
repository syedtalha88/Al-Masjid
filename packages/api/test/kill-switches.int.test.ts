// PHASE_08 T8.9 — the Super Admin's kill switches and banners, one block per switch (the push pause is covered by
// notification-routes.int.test.ts, T4.7): admin read-only mode ★ (step-up, audited, masjid admins' writes → 503
// READ_ONLY_MODE while reads, sign-out and the Super Admin's own work go on), the maintenance banner (both apps:
// `/auth/me` and `/config`) and the incident banner (musallis only: `/config`), each set in four languages and taken down.
import { processUserHandle } from '@mc/db/testing';
import { adminMeSchema, publicConfigSchema, superSettingsSchema } from '@mc/shared/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPublicApp } from '../src/app.ts';
import { deviceAuthenticator } from '../src/auth/device.ts';
import { memoryRateLimiter } from '../src/http/rate-limit.ts';
import { apiPublicRoutes } from '../src/routes/index.ts';
import { silentLogger } from './helpers.ts';
import { CSRF, superHarness } from './super-harness.ts';

const harness = superHarness('kill_switches', new Date('2026-11-13T08:00:00Z'));
const { app, asSuper, stepUp, register, db, testDatabase, clock } = harness;

let masjidId = '';
let adminCookie = '';
let publicHandle: Awaited<ReturnType<typeof processUserHandle>> | undefined;

const asAdmin = (method: 'get' | 'post' | 'patch' | 'delete', path: string) => {
  const call = request(app())[method](`/api/admin${path}`).set('Cookie', adminCookie);
  return method === 'get' ? call : call.set(CSRF);
};
const me = async () => {
  const response = await asAdmin('get', '/auth/me');
  expect(response.status).toBe(200);
  return adminMeSchema.parse(response.body);
};
const publicConfig = async () => {
  if (!publicHandle) throw new Error('no mc_public handle');
  const db = publicHandle.handle;
  const publicApp = createPublicApp({
    logger: silentLogger(),
    release: 't',
    trustedProxyMode: 'none',
    clock,
    rateLimiter: memoryRateLimiter(),
    authenticateDevice: deviceAuthenticator({ db, clock }),
    routes: apiPublicRoutes({ db, turnstile: () => Promise.resolve(true) }),
  }).app;
  const response = await request(publicApp).get('/api/v1/config');
  expect(response.status).toBe(200);
  return publicConfigSchema.parse(response.body);
};
const settings = async () => superSettingsSchema.parse((await asSuper('get', '/settings')).body);

/** Placeholder banner text (not real copy) in all four languages. */
const banner = (tag: string) => ({
  en: `Test ${tag} banner EN`,
  hi: `Test ${tag} banner HI`,
  ur: `Test ${tag} banner UR`,
  te: `Test ${tag} banner TE`,
});

beforeAll(async () => {
  publicHandle = await processUserHandle(testDatabase(), 'mc_public');
  const created = await asSuper('post', '/masjids').send({
    name: 'Test Masjid Switches',
    area: 'Test Area',
    city: 'Hyderabad',
    state: 'Telangana',
    address: 'Test address',
    lat: 17.385,
    lng: 78.4867,
  });
  masjidId = (created.body as { id: string }).id;
  const admin = await asSuper('post', '/admins').send({
    displayName: 'Test Admin',
    uiLocale: 'en',
    masjidId,
    role: 'owner',
  });
  adminCookie = await register((admin.body as { inviteUrl: string }).inviteUrl);
  await asAdmin('post', '/auth/undertaking').send({ version: (await settings()).undertakingVersion });
});
afterAll(async () => {
  await publicHandle?.dispose();
});

describe('admin read-only mode ★ (T8.9)', () => {
  it('is off by default: a masjid admin writes, and /auth/me says so', async () => {
    expect((await settings()).adminReadOnly).toBe(false);
    expect((await me()).readOnly).toBe(false);
    expect((await asAdmin('patch', `/masjids/${masjidId}`).send({ hijriOffset: 1 })).status).toBe(200);
  });

  it('needs a step-up and only a Super Admin may turn it on', async () => {
    await stepUp(false);
    const refused = await asSuper('post', '/settings/read-only').send({ readOnly: true });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    const byAdmin = await request(app())
      .post('/api/super/settings/read-only')
      .set('Cookie', adminCookie)
      .set(CSRF)
      .send({ readOnly: true });
    expect(byAdmin.status).toBe(403);
    expect((await settings()).adminReadOnly).toBe(false);
  });

  it('on: every masjid admin write answers 503 READ_ONLY_MODE; reads go on; audited once', async () => {
    await stepUp(true);
    expect((await asSuper('post', '/settings/read-only').send({ readOnly: true })).body).toEqual({
      readOnly: true,
      changed: true,
    });
    expect((await asSuper('post', '/settings/read-only').send({ readOnly: true })).body).toEqual({
      readOnly: true,
      changed: false,
    });
    expect(await db().collection('audit_log').countDocuments({ action: 'settings.read_only_on' })).toBe(1);
    expect((await settings()).adminReadOnly).toBe(true);
    expect((await me()).readOnly).toBe(true);

    const blocked = await asAdmin('patch', `/masjids/${masjidId}`).send({ hijriOffset: 2 });
    expect(blocked.status).toBe(503);
    expect(blocked.headers['content-type']).toContain('application/problem+json');
    expect(blocked.body).toMatchObject({ code: 'READ_ONLY_MODE' });
    const post = await asAdmin('post', `/masjids/${masjidId}/items/announcement`).send({});
    expect(post.status).toBe(503); // refused before validation: nothing about the body is revealed
    expect((await asAdmin('get', `/masjids/${masjidId}`)).status).toBe(200);
    const profile = await db()
      .collection('masjids')
      .findOne({ name: 'Test Masjid Switches' }, { projection: { hijri_offset: 1 } });
    expect(profile?.['hijri_offset']).toBe(1); // the refused write changed nothing
  });

  it('on: the Super Admin keeps working (settings, banners) — the switch never locks out its owner', async () => {
    const saved = await asSuper('patch', '/settings').send({ defaultPushQuota: 9 });
    expect(saved.status).toBe(200);
  });

  it('on: the account stays safe — the admin can still end other sessions and sign out', async () => {
    expect((await asAdmin('delete', '/auth/sessions')).status).toBe(204);
    const other = await asSuper('post', '/admins').send({
      displayName: 'Test Admin Two',
      uiLocale: 'en',
      masjidId,
      role: 'editor',
    });
    const cookie = await register((other.body as { inviteUrl: string }).inviteUrl);
    const logout = await request(app()).post('/api/admin/auth/logout').set('Cookie', cookie).set(CSRF);
    expect(logout.status).toBe(204);
  });

  it('off again: writes work, audited as read_only_off', async () => {
    await stepUp(true);
    expect((await asSuper('post', '/settings/read-only').send({ readOnly: false })).body).toEqual({
      readOnly: false,
      changed: true,
    });
    expect(await db().collection('audit_log').countDocuments({ action: 'settings.read_only_off' })).toBe(1);
    // A new session for the first admin (the previous test ended theirs).
    const again = await asSuper('post', '/admins').send({
      displayName: 'Test Admin Three',
      uiLocale: 'en',
      masjidId,
      role: 'editor',
    });
    adminCookie = await register((again.body as { inviteUrl: string }).inviteUrl);
    await asAdmin('post', '/auth/undertaking').send({ version: (await settings()).undertakingVersion });
    expect((await me()).readOnly).toBe(false);
    expect((await asAdmin('patch', `/masjids/${masjidId}`).send({ hijriOffset: 0 })).status).toBe(200);
  });
});

describe('maintenance banner (T8.9) — both apps', () => {
  it('★: putting it up without a fresh step-up is refused (route and data layer); nothing is written', async () => {
    await stepUp(false);
    const refused = await asSuper('patch', '/settings').send({ maintenanceBanner: banner('maintenance') });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    expect((await settings()).maintenanceBanner).toBeUndefined();
    // Other settings stay plain (not ★).
    expect((await asSuper('patch', '/settings').send({ defaultPushQuota: 9 })).status).toBe(200);
    await stepUp(true);
  });

  it('refuses a banner that carries a payment address, in any language (04 R1, #160)', async () => {
    const response = await asSuper('patch', '/settings').send({
      maintenanceBanner: { ...banner('maintenance'), ur: 'Test banner pay testmasjid@okaxis' },
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'PAYMENT_DETAILS_IN_TEXT' });
    expect((await settings()).maintenanceBanner).toBeUndefined();
  });

  it('set in four languages: in settings, /auth/me (admin app) and /config (musalli app); audited', async () => {
    expect((await me()).maintenanceBanner).toBeUndefined();
    expect((await publicConfig()).maintenanceBanner).toBeUndefined();
    const saved = await asSuper('patch', '/settings').send({ maintenanceBanner: banner('maintenance') });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ changed: ['maintenance_banner'] });
    expect((await settings()).maintenanceBanner).toEqual(banner('maintenance'));
    expect((await me()).maintenanceBanner).toEqual(banner('maintenance'));
    expect((await publicConfig()).maintenanceBanner).toEqual(banner('maintenance'));
    const audit = await db()
      .collection('audit_log')
      .findOne({ action: 'settings.update' }, { sort: { at: -1 } });
    expect(audit?.['meta']).toEqual({ fields: ['maintenance_banner'] });
  });

  it('refuses a banner missing a language, over 300 characters, or with control characters', async () => {
    const { te: _te, ...three } = banner('maintenance');
    for (const maintenanceBanner of [
      three,
      { ...banner('maintenance'), en: 'x'.repeat(301) },
      { ...banner('maintenance'), hi: 'Test ‮ banner' },
      { ...banner('maintenance'), ur: '' },
    ]) {
      const response = await asSuper('patch', '/settings').send({ maintenanceBanner });
      expect(response.status).toBe(400);
    }
    expect((await settings()).maintenanceBanner).toEqual(banner('maintenance'));
  });

  it('null takes it down everywhere — no step-up needed to take a banner down', async () => {
    await stepUp(false);
    expect((await asSuper('patch', '/settings').send({ maintenanceBanner: null })).status).toBe(200);
    await stepUp(true);
    expect((await settings()).maintenanceBanner).toBeUndefined();
    expect((await me()).maintenanceBanner).toBeUndefined();
    expect((await publicConfig()).maintenanceBanner).toBeUndefined();
  });

  it('only a Super Admin may set it', async () => {
    const response = await request(app())
      .patch('/api/super/settings')
      .set('Cookie', adminCookie)
      .set(CSRF)
      .send({ maintenanceBanner: banner('maintenance') });
    expect(response.status).toBe(403);
  });
});

describe('incident banner (T8.9) — every musalli', () => {
  it('set: /config carries it to every musalli; the admin app does not show it', async () => {
    expect((await asSuper('patch', '/settings').send({ incidentBanner: banner('incident') })).status).toBe(200);
    expect((await settings()).incidentBanner).toEqual(banner('incident'));
    const config = await publicConfig();
    expect(config.incidentBanner).toEqual(banner('incident'));
    expect(config.maintenanceBanner).toBeUndefined();
    expect(Object.keys(await me())).not.toContain('incidentBanner');
  });

  it('null takes it down', async () => {
    expect((await asSuper('patch', '/settings').send({ incidentBanner: null })).status).toBe(200);
    expect((await publicConfig()).incidentBanner).toBeUndefined();
  });
});
