// PHASE_05 T5.8 (API) against a migrated MongoDB as api-admin's and api-public's own database users: the admin's B19
// routes (add only with `consentConfirmed: true` and valid details; replace; "Update received" → fulfilled at the cap;
// close / delete; other masjids unreachable; the private phone / note encrypted at rest, returned only to the masjid's
// own admin and audited) and the musalli's list (least-funded first, zakat filter, immutable per version) — with a
// sweep over EVERY public response for the private part. Fake people, UPI IDs and numbers only (10 §5).
import { randomUUID } from 'node:crypto';

import { parseId } from '@mc/db';
import { processUserHandle } from '@mc/db/testing';
import { beneficiaryListSchema, masjidBundleSchema } from '@mc/shared/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createPublicApp } from '../src/app.ts';
import { deviceAuthenticator } from '../src/auth/device.ts';
import { memoryRateLimiter } from '../src/http/rate-limit.ts';
import { processRetention } from '../src/jobs/retention/run.ts';
import { createLogger } from '../src/logger.ts';
import { apiPublicRoutes } from '../src/routes/index.ts';
import { silentLogger } from './helpers.ts';
import { CSRF, superHarness } from './super-harness.ts';

const { app, asSuper, register, db, testDatabase, clock } = superHarness('beneficiary_routes');

/** A BSON UUID for raw database reads (this package cannot import the driver). */
const uuid = (text: string = randomUUID()) => {
  const id = parseId(text);
  if (!id) throw new Error(`not a UUID: ${text}`);
  return id;
};
/** The collection with UUID ids (the driver's default types assume ObjectId). */
const rawPeople = () => db().collection<{ _id: ReturnType<typeof uuid> } & Record<string, unknown>>('beneficiaries');
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
    const url = `/api/admin/masjids/${masjidId}/beneficiaries${path}`;
    const built = request(app())[method](url).set('Cookie', cookie);
    return method === 'get' ? built : built.set(CSRF);
  };
  return { masjidId, cookie, call };
}

const logger = createLogger({ level: 'silent', process: 'worker', release: 't' });
async function asSystem<T>(run: (db: Awaited<ReturnType<typeof processUserHandle>>['handle']) => Promise<T>) {
  const system = await processUserHandle(testDatabase(), 'mc_system');
  try {
    return await run(system.handle);
  } finally {
    await system.dispose();
  }
}

const PHONE = '+910000000007';
const NOTE = 'Sample private note — DEV ONLY';
const personBody = (over: Record<string, unknown> = {}) => ({
  displayName: 'Test A.',
  category: 'widow',
  reason: 'Sample reason for development — not a real person.',
  reasonLocale: 'en',
  vpa: 'testperson@okexample',
  payeeName: 'Test Person A',
  capPaise: 300_000,
  zakatEligible: false,
  consentConfirmed: true,
  ...over,
});
type Person = { id: string; publicId: string; displayName: string; status: string; hasPrivate: boolean };
const list = async (call: Awaited<ReturnType<typeof activeMasjid>>['call']) =>
  ((await call('get')).body as { people: Person[] }).people;

describe('admin: /beneficiaries', () => {
  it('refuses a person without consentConfirmed: true or with bad details; nothing is written', async () => {
    const { masjidId, call } = await activeMasjid('Test Masjid Needy Consent');
    const { consentConfirmed: _consent, ...withoutConsent } = personBody();
    for (const body of [
      withoutConsent,
      personBody({ consentConfirmed: false }),
      personBody({ consentConfirmed: 'true' }),
      personBody({ displayName: '' }),
      personBody({ displayName: 'T'.repeat(41) }),
      personBody({ category: 'friend' }),
      personBody({ capPaise: 99 }),
      personBody({ capPaise: 1_000_000_001 }),
      personBody({ capPaise: 1000.5 }),
      personBody({ private: { phone: '9876500000' } }),
      personBody({ private: { address: 'Test' } }),
      personBody({ receivedPaise: 100 }), // not a field of the save
    ]) {
      expect((await call('post').send(body)).body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    }
    // A UPI ID the database would not accept is the data layer's refusal.
    for (const vpa of ['not-a-upi-id', 'a@b&am=1', 'test@1bank']) {
      expect((await call('post').send(personBody({ vpa }))).body).toMatchObject({
        status: 400,
        code: 'BENEFICIARY_INVALID',
      });
    }
    expect(await list(call)).toEqual([]);
    expect(
      await db()
        .collection('beneficiaries')
        .countDocuments({ masjid_id: uuid(masjidId) }),
    ).toBe(0);
    expect(
      await db()
        .collection('audit_log')
        .countDocuments({ action: { $regex: '^beneficiary\\.' }, masjid_id: uuid(masjidId) }),
    ).toBe(0);
  });

  it('adds, replaces, updates the amount to the cap (fulfilled), closes and deletes', async () => {
    const { masjidId, call } = await activeMasjid('Test Masjid Needy');
    const added = await call('post').send(personBody());
    expect(added.status).toBe(201);
    const { id, publicId } = added.body as { id: string; publicId: string };
    expect(added.body).toMatchObject({ status: 'active' });
    expect(publicId).toMatch(/^[A-Za-z0-9_-]{12}$/);

    const edited = await call('patch', `/${id}`).send(
      personBody({ displayName: 'Test Edited', vpa: 'other@okexample', payeeName: 'Other Name', zakatEligible: true }),
    );
    expect(edited.body).toEqual({ id, status: 'active' });
    expect((await call('patch', `/${id}`).send(personBody({ consentConfirmed: false }))).status).toBe(400);

    expect((await call('post', `/${id}/received`).send({ receivedPaise: 120_000 })).body).toEqual({
      status: 'active',
      fundedPermille: 400,
    });
    for (const receivedPaise of [-1, 0.5, '100', 1_000_000_000_001]) {
      expect((await call('post', `/${id}/received`).send({ receivedPaise })).status).toBe(400);
    }
    expect(await list(call)).toMatchObject([
      { id, displayName: 'Test Edited', receivedPaise: 120_000, fundedPermille: 400, status: 'active' },
    ]);
    expect((await call('post', `/${id}/received`).send({ receivedPaise: 300_000 })).body).toEqual({
      status: 'fulfilled',
      fundedPermille: 1000,
    });
    expect(await list(call)).toMatchObject([{ id, status: 'fulfilled' }]);

    expect((await call('post', `/${id}/close`)).status).toBe(204);
    expect(await list(call)).toMatchObject([{ id, status: 'closed' }]);
    expect((await call('post', `/${id}/close`)).body).toMatchObject({ status: 404, code: 'BENEFICIARY_NOT_FOUND' });
    expect((await call('post', `/${id}/received`).send({ receivedPaise: 1 })).body).toMatchObject({
      code: 'BENEFICIARY_NOT_FOUND',
    });

    const second = (await call('post').send(personBody({ displayName: 'Test Mistake' }))).body as { id: string };
    expect((await call('delete', `/${second.id}`)).status).toBe(204);
    expect((await list(call)).map((person) => person.displayName)).toEqual(['Test Edited']); // deleted: not listed
    expect((await call('delete', '/not-an-id')).body).toMatchObject({ status: 404, code: 'BENEFICIARY_NOT_FOUND' });

    // The audit trail: the UPI details at create and old → new at the change (04 R13) — never the name or reason.
    const audit = await db()
      .collection('audit_log')
      .find({ action: { $regex: '^beneficiary\\.' }, masjid_id: uuid(masjidId) })
      .sort({ at: 1 })
      .toArray();
    expect(audit.map((entry) => entry['action'] as string)).toEqual([
      'beneficiary.create',
      'beneficiary.update',
      'beneficiary.received',
      'beneficiary.received',
      'beneficiary.close',
      'beneficiary.create',
      'beneficiary.delete',
    ]);
    expect(audit[1]?.['meta']).toMatchObject({
      vpa_old: 'testperson@okexample',
      vpa_new: 'other@okexample',
      payee_old: 'Test Person A',
      payee_new: 'Other Name',
    });
    expect(JSON.stringify(audit)).not.toMatch(/Test Edited|Test Mistake|Sample reason/);
  });

  it('the private phone / note: encrypted at rest, only for this masjid’s admin, every view audited', async () => {
    const mine = await activeMasjid('Test Masjid Needy Private');
    const other = await activeMasjid('Test Masjid Needy Other');
    const added = await mine.call('post').send(personBody({ private: { phone: PHONE, note: NOTE } }));
    const { id } = added.body as { id: string };
    const bare = (await mine.call('post').send(personBody({ displayName: 'Test Bare', private: {} }))).body as {
      id: string;
    };

    // At rest: a ciphertext, never the words.
    const stored = await rawPeople().findOne({ _id: uuid(id) });
    expect(stored?.['private_enc']).toMatch(/^v1:k1:/);
    expect(JSON.stringify(stored)).not.toContain(PHONE);
    expect(JSON.stringify(stored)).not.toContain('Sample private note');
    expect(await rawPeople().findOne({ _id: uuid(bare.id) })).not.toHaveProperty('private_enc');

    // The list says only that something private exists.
    const people = await list(mine.call);
    expect(people.find((person) => person.id === id)).toMatchObject({ hasPrivate: true });
    expect(people.find((person) => person.id === bare.id)).toMatchObject({ hasPrivate: false });
    expect(JSON.stringify(people)).not.toMatch(/0000000007|private note|v1:k1/);

    const viewed = await mine.call('get', `/${id}/private`);
    expect(viewed.body).toEqual({ private: { phone: PHONE, note: NOTE } });
    expect(viewed.headers['cache-control']).toBe('no-store');
    expect((await mine.call('get', `/${bare.id}/private`)).body).toEqual({ private: null });
    const views = () =>
      db().collection('audit_log').countDocuments({ action: 'beneficiary.private_view', target_id: id });
    expect(await views()).toBe(1);

    // Another masjid's admin: not through their own masjid, not through mine; the Super Admin has no such route.
    const asOther = (masjidId: string) =>
      request(app()).get(`/api/admin/masjids/${masjidId}/beneficiaries/${id}/private`).set('Cookie', other.cookie);
    expect((await asOther(other.masjidId)).body).toMatchObject({ status: 404, code: 'BENEFICIARY_NOT_FOUND' });
    expect((await asOther(mine.masjidId)).body).toMatchObject({ status: 404, code: 'MASJID_NOT_FOUND' });
    expect((await asSuper('get', `/masjids/${mine.masjidId}/beneficiaries/${id}/private`)).status).toBe(404);
    expect(await request(app()).get(`/api/admin/masjids/${mine.masjidId}/beneficiaries/${id}/private`)).toMatchObject({
      status: 401,
    });
    expect(await views()).toBe(1);

    // An edit that leaves `private` out keeps it; `null` removes it.
    await mine.call('patch', `/${id}`).send(personBody({ displayName: 'Test Kept' }));
    expect((await mine.call('get', `/${id}/private`)).body).toEqual({ private: { phone: PHONE, note: NOTE } });
    await mine.call('patch', `/${id}`).send(personBody({ displayName: 'Test Kept', private: null }));
    expect((await mine.call('get', `/${id}/private`)).body).toEqual({ private: null });
    expect(await rawPeople().findOne({ _id: uuid(id) })).not.toHaveProperty('private_enc');
  });

  it('another masjid’s admin gets 404 on every route', async () => {
    const mine = await activeMasjid('Test Masjid Needy Two');
    const other = await activeMasjid('Test Masjid Needy Three');
    const { id } = (await other.call('post').send(personBody())).body as { id: string };
    const base = `/api/admin/masjids/${other.masjidId}/beneficiaries`;
    const asMine = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
      request(app())[method](`${base}${path}`).set('Cookie', mine.cookie).set(CSRF);
    for (const response of [
      await asMine('get', ''),
      await asMine('post', '').send(personBody()),
      await asMine('patch', `/${id}`).send(personBody()),
      await asMine('post', `/${id}/received`).send({ receivedPaise: 1 }),
      await asMine('post', `/${id}/close`),
      await asMine('delete', `/${id}`),
    ]) {
      expect(response.body).toMatchObject({ status: 404, code: 'MASJID_NOT_FOUND' });
    }
    // Through their own masjid's path the person does not exist either.
    expect((await mine.call('post', `/${id}/received`).send({ receivedPaise: 1 })).body).toMatchObject({
      status: 404,
      code: 'BENEFICIARY_NOT_FOUND',
    });
    expect(await list(other.call)).toMatchObject([{ id, receivedPaise: 0, status: 'active' }]);
  });
});

describe('musalli: GET /masjids/:id/beneficiaries', () => {
  it('least-funded first, the zakat filter, immutable per version — and the private part in NO public response', async () => {
    const { masjidId, call } = await activeMasjid('Test Masjid Needy Public');
    const add = async (over: Record<string, unknown>) =>
      ((await call('post').send(personBody(over))).body as { id: string; publicId: string }).id;
    const half = await add({ displayName: 'Test Half', private: { phone: PHONE, note: NOTE } });
    await add({ displayName: 'Test Zakat', zakatEligible: true, private: { note: NOTE } });
    const full = await add({ displayName: 'Test Full' });
    await call('post', `/${half}/received`).send({ receivedPaise: 150_000 });
    await call('post', `/${full}/received`).send({ receivedPaise: 300_000 }); // fulfilled: gone

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
      const bodies: string[] = [];
      /** A versioned GET: the redirect to the current version, then the immutable response. */
      const versioned = async (path: string) => {
        const first = await request(publicApp).get(path);
        expect(first.status, path).toBe(302);
        const target = (first.headers['location'] ?? '').replace(/^https?:\/\/[^/]+/, '');
        const response = await request(publicApp).get(target);
        expect(response.status, target).toBe(200);
        expect(response.headers['cache-control']).toContain('immutable');
        bodies.push(first.text, JSON.stringify(first.headers), response.text, JSON.stringify(response.headers));
        return response;
      };

      const people = beneficiaryListSchema.parse((await versioned(`/api/v1/masjids/${masjidId}/beneficiaries`)).body);
      expect(people.people.map((person) => [person.displayName, person.fundedPermille])).toEqual([
        ['Test Zakat', 0],
        ['Test Half', 500],
      ]);
      expect(people.people[1]).toMatchObject({
        vpa: 'testperson@okexample',
        payeeName: 'Test Person A',
        capPaise: 300_000,
        receivedPaise: 150_000,
        zakatEligible: false,
      });
      const zakat = await versioned(`/api/v1/masjids/${masjidId}/beneficiaries?zakat=1`);
      expect(beneficiaryListSchema.parse(zakat.body).people.map((person) => person.displayName)).toEqual([
        'Test Zakat',
      ]);
      expect((await request(publicApp).get(`/api/v1/masjids/${masjidId}/beneficiaries?zakat=yes`)).status).toBe(400);
      expect((await request(publicApp).get(`/api/v1/masjids/${uuid().toString()}/beneficiaries`)).status).toBe(404);

      const bundle = await versioned(`/api/v1/masjids/${masjidId}/bundle`);
      const parsed = masjidBundleSchema.parse(bundle.body);
      if (parsed.status !== 'active') throw new Error('masjid not active');
      expect(parsed.sections).toMatchObject({ needy: 2 });

      // Every other public read of this masjid, then the sweep (T5.8 acceptance).
      await versioned(`/api/v1/masjids/${masjidId}/feed`);
      await versioned(`/api/v1/masjids/${masjidId}/ruqyah`);
      const versions = await request(publicApp).get(`/api/v1/masjids/versions?ids=${masjidId}`);
      const followCode = parsed.masjid.followCode;
      const resolved = await request(publicApp).get(`/api/v1/masjids/resolve/${followCode}`);
      const config = await request(publicApp).get('/api/v1/config');
      for (const response of [versions, resolved, config]) {
        expect(response.status).toBe(200);
        bodies.push(response.text, JSON.stringify(response.headers));
      }
      const everything = bodies.join('\n');
      expect(everything).toContain('Test Half'); // the sweep really saw the people
      expect(everything).not.toMatch(/private|0000000007|Sample private note|v1:k1|consent|created_by|createdBy/i);
      // The internal ids never leave either (people are addressed by their public id).
      expect(everything).not.toContain(half);
    } finally {
      await asPublic.dispose();
    }
  });
});

describe('worker: retention', () => {
  it('purges fulfilled, closed and deleted people with their history 90 days later; listed people stay', async () => {
    const { masjidId, call } = await activeMasjid('Test Masjid Needy Retention');
    const add = async (displayName: string) =>
      ((await call('post').send(personBody({ displayName, private: { note: NOTE } }))).body as { id: string }).id;
    const stays = await add('Test Stays');
    const fulfilled = await add('Test Fulfilled');
    const closed = await add('Test Closed');
    const deleted = await add('Test Deleted');
    await call('post', `/${stays}/received`).send({ receivedPaise: 1000 });
    await call('post', `/${fulfilled}/received`).send({ receivedPaise: 300_000 });
    await call('post', `/${closed}/close`);
    await call('delete', `/${deleted}`);
    const left = () => rawPeople().countDocuments({ masjid_id: uuid(masjidId) });
    const history = (id: string) =>
      db()
        .collection('beneficiary_amount_history')
        .countDocuments({ beneficiary_id: uuid(id) });
    expect(await left()).toBe(4);
    expect(await history(fulfilled)).toBe(1);

    const back = clock.now();
    const day = 24 * 60 * 60 * 1000;
    clock.set(new Date(back.getTime() + 89 * day));
    expect(await asSystem((handle) => processRetention({ db: handle, clock, logger }))).toMatchObject({
      beneficiaries: 0,
    });
    expect(await left()).toBe(4);
    clock.set(new Date(back.getTime() + 90 * day + 60_000));
    const run = await asSystem((handle) => processRetention({ db: handle, clock, logger }));
    expect(run.beneficiaries).toBeGreaterThanOrEqual(3); // this masjid's three (and other tests' ended people)
    clock.set(back);

    const remaining = await rawPeople()
      .find({ masjid_id: uuid(masjidId) })
      .toArray();
    expect(remaining.map((person) => person['display_name'])).toEqual(['Test Stays']);
    expect(await history(fulfilled)).toBe(0);
    expect(await history(stays)).toBe(1);
    // api-admin's own user cannot do the purge: the history is append-only for it (02 §4.3).
    expect((await call('get')).body).toMatchObject({ people: [{ id: stays, status: 'active' }] });
  });
});
