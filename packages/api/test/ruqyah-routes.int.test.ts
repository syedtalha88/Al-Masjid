// PHASE_03 T3.15 (API) against a migrated MongoDB as api-admin's and api-public's own database users: the admin's B15
// routes (add library / text / audio, replace, order, delete; the ownership tick and title for recordings, another
// masjid's recording, the 50-entry limit, other masjids unreachable) and the musalli's `GET /masjids/:id/ruqyah?v=`
// (versioned, grouped, no private fields) with the bundle's section count. Religious text: the 10 §5 placeholders only.
import { randomUUID } from 'node:crypto';

import { parseId } from '@mc/db';
import { processUserHandle } from '@mc/db/testing';
import { LIBRARY_IMPORT_FORMAT, ruqyahListSchema } from '@mc/shared/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createPublicApp } from '../src/app.ts';
import { deviceAuthenticator } from '../src/auth/device.ts';
import { memoryRateLimiter } from '../src/http/rate-limit.ts';
import { apiPublicRoutes } from '../src/routes/index.ts';
import { silentLogger } from './helpers.ts';
import { CSRF, superHarness } from './super-harness.ts';

const { app, asSuper, stepUp, register, db, testDatabase, clock } = superHarness('ruqyah_routes');

const ARABIC = 'نص تجريبي للعرض فقط';
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
  const call = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path = '') => {
    const url = `/api/admin/masjids/${masjidId}/ruqyah${path}`;
    const built = request(app())[method](url).set('Cookie', cookie);
    return method === 'get' ? built : built.set(CSRF);
  };
  return { masjidId, cookie, call };
}

/** A verified library entry of `kind` (imported as draft, then verified by the Super Admin). */
async function verifiedEntry(kind: string, reference: string) {
  const entry = {
    kind,
    arabic: ARABIC,
    transliteration: { en: 'Sample transliteration — DEV ONLY' },
    translation: { en: 'Sample translation text for development. Not a real hadith.' },
    reference,
    source_name: 'Development fixture',
    source_license: 'N/A — not for production',
    tags: ['ruqyahtest'],
    ...(kind === 'dua' ? { dua_category: 'illness' } : {}),
  };
  await stepUp(true);
  const bytes = Buffer.from(JSON.stringify({ format: LIBRARY_IMPORT_FORMAT, version: 1, entries: [entry] }));
  await asSuper('post', '/library/import').attach('file', bytes, {
    filename: 'library.json',
    contentType: 'application/json',
  });
  const listed = await asSuper('get', `/library?q=${encodeURIComponent(reference)}`);
  const id = (listed.body as { entries: { id: string }[] }).entries[0]?.id ?? '';
  await asSuper('post', `/library/${id}/verify`).send({ verifiedBy: 'Test Reviewer' });
  return id;
}

const textBody = (over: Record<string, unknown> = {}) => ({
  category: 'nazar',
  source: 'text',
  text: { arabic: ARABIC, translation: 'Sample masjid text — test only.', translationLocale: 'en', reference: 'DEV-1' },
  ...over,
});
const audioBody = (masjidId: string, audio: Record<string, unknown> = {}) => ({
  category: 'general',
  source: 'audio',
  title: 'Sample recording — test only',
  audio: { key: `m/${masjidId}/a/${randomUUID()}`, durationS: 120, rightsConfirmed: true, ...audio },
});

describe('admin: GET / POST / PATCH / DELETE /ruqyah, PUT /ruqyah/order', () => {
  it('adds the three sources, replaces, orders and deletes; refusals keep the list as it was', async () => {
    const { masjidId, call } = await activeMasjid('Test Masjid Ruqyah');
    const dua = await verifiedEntry('dua', 'DEV-RUQYAH-001');
    expect((await call('get')).body).toEqual({ entries: [] });

    const text = await call('post').send(textBody({ instructions: { text: 'Sample instruction.', locale: 'ur' } }));
    expect(text.status).toBe(201);
    const library = await call('post').send({ category: 'shifa', source: 'library', libraryId: dua });
    expect(library.status).toBe(201);
    const audio = await call('post').send(audioBody(masjidId));
    expect(audio.status).toBe(201);
    const ids = [text, library, audio].map((response) => (response.body as { id: string }).id);

    const list = await call('get');
    expect(list.status).toBe(200);
    const entries = (list.body as { entries: Record<string, unknown>[] }).entries;
    expect(entries.map((entry) => entry['id'])).toEqual(ids);
    expect(entries[0]).toMatchObject({ source: 'text', instructions: 'Sample instruction.', instructionsLocale: 'ur' });
    expect(entries[1]).toMatchObject({ source: 'library', libraryId: dua, library: { id: dua, kind: 'dua' } });
    expect(entries[2]).toMatchObject({ source: 'audio', audio: { durationS: 120 } });

    // Recordings: the tick and a title are required (contract), and the key must be this masjid's (data layer).
    const noTick = await call('post').send(audioBody(masjidId, { rightsConfirmed: false }));
    expect(noTick.body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    const { title: _title, ...untitled } = audioBody(masjidId);
    expect((await call('post').send(untitled)).body).toMatchObject({ code: 'VALIDATION_FAILED' });
    const foreign = await call('post').send(audioBody(randomUUID()));
    expect(foreign.body).toMatchObject({ status: 400, code: 'RUQYAH_INVALID' });
    // A draft or unknown library entry.
    const unknown = await call('post').send({ category: 'general', source: 'library', libraryId: randomUUID() });
    expect(unknown.body).toMatchObject({ status: 404, code: 'LIBRARY_ENTRY_NOT_FOUND' });

    const patched = await call('patch', `/${ids[0] ?? ''}`).send(textBody({ category: 'protection' }));
    expect(patched.status).toBe(200);
    const order = await call('put', '/order').send({ ids: [...ids].reverse() });
    expect(order.status).toBe(200);
    const reordered = (order.body as { entries: { id: string; category: string; instructions?: string }[] }).entries;
    expect(reordered.map((entry) => entry.id)).toEqual([...ids].reverse());
    expect(reordered[2]).toMatchObject({ category: 'protection' });
    expect(reordered[2]).not.toHaveProperty('instructions');
    expect((await call('put', '/order').send({ ids: ids.slice(1) })).body).toMatchObject({
      status: 409,
      code: 'RUQYAH_ORDER_INVALID',
    });

    expect((await call('delete', `/${ids[1] ?? ''}`)).status).toBe(204);
    expect((await call('delete', `/${ids[1] ?? ''}`)).body).toMatchObject({ status: 404, code: 'RUQYAH_NOT_FOUND' });
    expect((await call('patch', '/not-an-id').send(textBody())).body).toMatchObject({ code: 'RUQYAH_NOT_FOUND' });
    expect(((await call('get')).body as { entries: unknown[] }).entries).toHaveLength(2);
    const audit = await db()
      .collection('audit_log')
      .countDocuments({ action: { $regex: '^ruqyah\\.' }, masjid_id: uuid(masjidId) });
    expect(audit).toBe(6); // 3 adds, 1 replace, 1 order, 1 delete — refusals write nothing
  });

  it('another masjid’s admin gets 404; the 51st entry is refused', async () => {
    const mine = await activeMasjid('Test Masjid Ruqyah Two');
    const other = await activeMasjid('Test Masjid Ruqyah Three');
    const response = await request(app())
      .post(`/api/admin/masjids/${other.masjidId}/ruqyah`)
      .set('Cookie', mine.cookie)
      .set(CSRF)
      .send(textBody());
    expect(response.body).toMatchObject({ status: 404, code: 'MASJID_NOT_FOUND' });
    // 49 entries straight into the database, then two through the API.
    const now = clock.now();
    await db()
      .collection<{ _id: ReturnType<typeof uuid> }>('ruqyah_entries')
      .insertMany(
        Array.from({ length: 49 }, (_, sort) => ({
          _id: uuid(),
          masjid_id: uuid(mine.masjidId),
          category: 'general',
          source: 'text',
          text: { arabic: ARABIC, translation: 'Sample — test only.', translation_locale: 'en' },
          sort,
          status: 'active',
          masjid_visible: true,
          created_by: uuid(),
          created_at: now,
          updated_at: now,
        })),
      );
    expect((await mine.call('post').send(textBody())).status).toBe(201);
    expect((await mine.call('post').send(textBody())).body).toMatchObject({
      status: 409,
      code: 'RUQYAH_LIMIT_REACHED',
    });
  });
});

describe('musalli: GET /masjids/:id/ruqyah?v= and the bundle count', () => {
  it('versioned and grouped, never the private fields; masjid text has no source line', async () => {
    const { masjidId, call } = await activeMasjid('Test Masjid Ruqyah Public');
    const hadith = await verifiedEntry('hadith', 'DEV-RUQYAH-002');
    await call('post').send(audioBody(masjidId));
    await call('post').send({ category: 'sihr', source: 'library', libraryId: hadith });
    await call('post').send(textBody());

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
      const first = await request(publicApp).get(`/api/v1/masjids/${masjidId}/ruqyah`);
      expect(first.status).toBe(302);
      const location = first.headers['location'] ?? '';
      expect(location).toMatch(/\/ruqyah\?v=\d+$/);
      const list = await request(publicApp).get(location.replace(/^https?:\/\/[^/]+/, ''));
      expect(list.status).toBe(200);
      expect(list.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      const body = ruqyahListSchema.parse(list.body);
      expect(body.sections.map((section) => section.category)).toEqual(['nazar', 'sihr', 'general']);
      const [masjidText] = body.sections[0]?.entries ?? [];
      expect(masjidText).toMatchObject({ source: 'text', text: { reference: 'DEV-1' } });
      expect(masjidText).not.toHaveProperty('library');
      expect(body.sections[1]?.entries[0]?.library).toMatchObject({ sourceName: 'Development fixture' });
      expect(JSON.stringify(list.body)).not.toMatch(/rights|created|libraryId|masjid_visible|status/i);

      const bundleFirst = await request(publicApp).get(`/api/v1/masjids/${masjidId}/bundle`);
      const bundle = await request(publicApp).get(
        (bundleFirst.headers['location'] ?? '').replace(/^https?:\/\/[^/]+/, ''),
      );
      expect(bundle.body).toMatchObject({ sections: { ruqyah: 3, needy: 0 } });
    } finally {
      await asPublic.dispose();
    }
  });
});
