// PHASE_03 T3.16 (API) against a migrated MongoDB as api-admin's and api-public's own database users: the admin's B17
// routes (add, replace, delete; `consentConfirmed: true` required, E.164 only, the 10-contact limit, other masjids
// unreachable) and the musalli's bundle `contacts` (both audiences, no private fields). Fake names and numbers only.
import { randomUUID } from 'node:crypto';

import { parseId } from '@mc/db';
import { processUserHandle } from '@mc/db/testing';
import { masjidBundleSchema } from '@mc/shared/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createPublicApp } from '../src/app.ts';
import { deviceAuthenticator } from '../src/auth/device.ts';
import { memoryRateLimiter } from '../src/http/rate-limit.ts';
import { apiPublicRoutes } from '../src/routes/index.ts';
import { silentLogger } from './helpers.ts';
import { CSRF, superHarness } from './super-harness.ts';

const { app, asSuper, register, db, testDatabase, clock } = superHarness('contact_routes');

/** A BSON UUID for raw database writes (this package cannot import the driver). */
const uuid = (text: string = randomUUID()) => {
  const id = parseId(text);
  if (!id) throw new Error(`not a UUID: ${text}`);
  return id;
};
const offset = (jamaatOffsetMin: number) => ({
  adhanMode: 'auto',
  adhanAdjustMin: 0,
  jamaatMode: 'offset',
  jamaatOffsetMin,
});

/** A new active masjid with an owner who accepted the undertaking. */
async function activeMasjid(name: string) {
  const masjid = await asSuper('post', '/masjids').send({
    name,
    area: 'Test Area',
    city: 'Hyderabad',
    state: 'Telangana',
    address: 'Test address',
    lat: 17.385,
    lng: 78.4867,
  });
  const masjidId = (masjid.body as { id: string }).id;
  const admin = await asSuper('post', '/admins').send({
    displayName: 'Test Imam',
    uiLocale: 'en',
    masjidId,
    role: 'owner',
  });
  const cookie = await register((admin.body as { inviteUrl: string }).inviteUrl);
  const settings = await asSuper('get', '/settings');
  const version = (settings.body as { undertakingVersion: string }).undertakingVersion;
  await request(app()).post('/api/admin/auth/undertaking').set(CSRF).set('Cookie', cookie).send({ version });
  const timings = await request(app())
    .put(`/api/admin/masjids/${masjidId}/timings`)
    .set('Cookie', cookie)
    .set(CSRF)
    .set('If-Match', '"0"')
    .send({
      prayers: { fajr: offset(20), dhuhr: offset(15), asr: offset(15), maghrib: offset(5), isha: offset(15) },
      jumuah: [{ seq: 1, jamaatTime: '13:30' }],
      notify: false,
    });
  expect(timings.status).toBe(200);
  expect((await asSuper('post', `/masjids/${masjidId}/activate`)).status).toBe(204);
  const call = (method: 'get' | 'post' | 'patch' | 'delete', path = '') => {
    const url = `/api/admin/masjids/${masjidId}/contacts${path}`;
    const built = request(app())[method](url).set('Cookie', cookie);
    return method === 'get' ? built : built.set(CSRF);
  };
  return { masjidId, cookie, call };
}

const contactBody = (over: Record<string, unknown> = {}) => ({
  name: 'Test Contact',
  role: 'Sample role',
  topics: 'Sample topics',
  whatsapp: '+910000000001',
  audience: 'brothers',
  consentConfirmed: true,
  ...over,
});

describe('admin: GET / POST / PATCH / DELETE /contacts', () => {
  it('refuses a contact without consentConfirmed: true or with a number not in E.164', async () => {
    const { masjidId, call } = await activeMasjid('Test Masjid Contacts Consent');
    const { consentConfirmed: _consent, ...withoutConsent } = contactBody();
    for (const body of [
      withoutConsent,
      contactBody({ consentConfirmed: false }),
      contactBody({ consentConfirmed: 'true' }),
      contactBody({ whatsapp: '9876500000' }),
      contactBody({ whatsapp: '+91 00000 00000' }),
      contactBody({ audience: 'everyone' }),
    ]) {
      expect((await call('post').send(body)).body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    }
    expect(((await call('get')).body as { contacts: unknown[] }).contacts).toEqual([]);
    expect(
      await db()
        .collection('audit_log')
        .countDocuments({ action: { $regex: '^contact\\.' }, masjid_id: uuid(masjidId) }),
    ).toBe(0);
  });

  it('adds, replaces and deletes; brothers’ contacts list first; audit without the name or number', async () => {
    const { masjidId, call } = await activeMasjid('Test Masjid Contacts');
    const sister = await call('post').send(contactBody({ name: 'Test Sister', audience: 'sisters' }));
    expect(sister.status).toBe(201);
    const brother = await call('post').send(contactBody({ name: 'Test Brother', whatsapp: '+910000000002' }));
    expect(brother.status).toBe(201);
    const [sisterId, brotherId] = [sister, brother].map((response) => (response.body as { id: string }).id);

    const list = (await call('get')).body as { contacts: Record<string, unknown>[] };
    expect(list.contacts.map((row) => row['id'])).toEqual([brotherId, sisterId]);
    expect(list.contacts[0]).toEqual({
      id: brotherId,
      name: 'Test Brother',
      role: 'Sample role',
      topics: 'Sample topics',
      whatsapp: '+910000000002',
      audience: 'brothers',
    });

    const { role: _role, topics: _topics, ...bare } = contactBody({ name: 'Test Sister Renamed', audience: 'sisters' });
    expect((await call('patch', `/${sisterId ?? ''}`).send(bare)).status).toBe(200);
    const renamed = ((await call('get')).body as { contacts: Record<string, unknown>[] }).contacts[1];
    expect(renamed).toMatchObject({ name: 'Test Sister Renamed' });
    expect(renamed).not.toHaveProperty('role');
    expect((await call('patch', `/${sisterId ?? ''}`).send({ ...bare, consentConfirmed: false })).status).toBe(400);

    expect((await call('delete', `/${sisterId ?? ''}`)).status).toBe(204);
    expect((await call('delete', `/${sisterId ?? ''}`)).body).toMatchObject({ status: 404, code: 'CONTACT_NOT_FOUND' });
    expect((await call('patch', '/not-an-id').send(contactBody())).body).toMatchObject({ code: 'CONTACT_NOT_FOUND' });
    expect(((await call('get')).body as { contacts: unknown[] }).contacts).toHaveLength(1);

    const audit = await db()
      .collection('audit_log')
      .find({ action: { $regex: '^contact\\.' }, masjid_id: uuid(masjidId) })
      .toArray();
    expect(audit).toHaveLength(4); // 2 adds, 1 replace, 1 delete — refusals write nothing
    expect(JSON.stringify(audit)).not.toMatch(/0000000001|0000000002|Test Brother|Test Sister/);
  });

  it('another masjid’s admin gets 404; the 11th contact is refused', async () => {
    const mine = await activeMasjid('Test Masjid Contacts Two');
    const other = await activeMasjid('Test Masjid Contacts Three');
    const response = await request(app())
      .post(`/api/admin/masjids/${other.masjidId}/contacts`)
      .set('Cookie', mine.cookie)
      .set(CSRF)
      .send(contactBody());
    expect(response.body).toMatchObject({ status: 404, code: 'MASJID_NOT_FOUND' });
    const now = clock.now();
    await db()
      .collection<{ _id: ReturnType<typeof uuid> }>('masjid_contacts')
      .insertMany(
        Array.from({ length: 9 }, (_, sort) => ({
          _id: uuid(),
          masjid_id: uuid(mine.masjidId),
          name: 'Test Contact',
          whatsapp: '+910000000003',
          audience: 'sisters',
          consent_confirmed: true,
          sort,
          status: 'active',
          masjid_visible: true,
          created_by: uuid(),
          created_at: now,
          updated_at: now,
        })),
      );
    expect((await mine.call('post').send(contactBody())).status).toBe(201);
    expect((await mine.call('post').send(contactBody())).body).toMatchObject({
      status: 409,
      code: 'CONTACT_LIMIT_REACHED',
    });
  });
});

describe('musalli: the bundle’s contacts', () => {
  it('both audiences, never the consent, creator or status', async () => {
    const { masjidId, call } = await activeMasjid('Test Masjid Contacts Public');
    await call('post').send(contactBody({ name: 'Test Sister', audience: 'sisters' }));
    await call('post').send(contactBody({ name: 'Test Brother' }));

    const asPublic = await processUserHandle(testDatabase(), 'mc_public');
    try {
      const publicApp = createPublicApp({
        logger: silentLogger(),
        release: 't',
        trustedProxyMode: 'none',
        clock,
        rateLimiter: memoryRateLimiter(),
        authenticateDevice: deviceAuthenticator({ db: asPublic.handle, clock }),
        routes: apiPublicRoutes({ db: asPublic.handle, turnstile: () => Promise.resolve(true) }),
      }).app;
      const first = await request(publicApp).get(`/api/v1/masjids/${masjidId}/bundle`);
      const bundle = await request(publicApp).get((first.headers['location'] ?? '').replace(/^https?:\/\/[^/]+/, ''));
      expect(bundle.status).toBe(200);
      const parsed = masjidBundleSchema.parse(bundle.body);
      if (parsed.status !== 'active') throw new Error('masjid not active');
      expect(parsed.contacts?.map((row) => [row.name, row.audience])).toEqual([
        ['Test Brother', 'brothers'],
        ['Test Sister', 'sisters'],
      ]);
      expect(JSON.stringify((bundle.body as { contacts: unknown }).contacts)).not.toMatch(
        /consent|created|status|masjid_visible|"sort"/i,
      );
    } finally {
      await asPublic.dispose();
    }
  });
});
