// PHASE_03 T3.1 (API) against a migrated MongoDB as the real mc_admin user: the masjid-scoped Admin Home reads —
// stats, push quota, schedule — for the admin's own masjid; another masjid, a malformed id and the Super Admin (not a
// member) all get the uniform 404; no session → 401. T3.2: the timings editor; T3.3: special dates and Ramadan.
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type DbHandle, publicScope } from '@mc/db';
import { runMigrations } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';
import { registerCredential } from '@mc/db/state';
import { createTestDatabase, processUserHandle, type TestDatabase } from '@mc/db/testing';
import { ManualClock } from '@mc/shared/clock';
import {
  adminMasjidStatsSchema,
  adminScheduleSchema,
  adminSpecialDatesSchema,
  imageUploadedSchema,
  pushQuotaSchema,
  ramadanSchema,
  specialDateSavedSchema,
  timingsPreviewSchema,
  timingsSavedSchema,
} from '@mc/shared/contracts';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAdminApp } from '../src/app.ts';
import { sessionAuthenticator } from '../src/auth/session.ts';
import { type FieldKeyRing, hashToken, newToken } from '../src/crypto/field.ts';
import { memoryRateLimiter } from '../src/http/rate-limit.ts';
import { bootstrapSuperAdminInvite } from '../src/jobs/bootstrap-super-admin.ts';
import { fileMediaStore } from '../src/media/store.ts';
import { adminRoutes } from '../src/routes/index.ts';
import { passkeyDeps, silentLogger } from './helpers.ts';

const ORIGIN = 'https://admin.test';
const CSRF = { Origin: ORIGIN, 'X-MC-CSRF': '1' };
const pepper = randomBytes(32);
const keyRing: FieldKeyRing = { currentId: 'k1', keys: new Map([['k1', randomBytes(32)]]) };
const clock = new ManualClock(new Date('2026-10-16T08:00:00Z')); // 13:30 IST

let test: TestDatabase | undefined;
let mediaDir = '';
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
    ...adminRoutes({
      db: h(),
      pepper,
      adminOrigin: ORIGIN,
      keyRing,
      ...passkeyDeps(ORIGIN, clock),
      media: { store: fileMediaStore(mediaDir), origin: 'https://media.test' },
    }),
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
  mediaDir = await mkdtemp(join(tmpdir(), 'mc-media-int-'));
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
  await rm(mediaDir, { recursive: true, force: true });
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

describe('special dates & Ramadan API (T3.3)', () => {
  const ENTRY = {
    type: 'eid_ul_fitr',
    date: '2026-10-20',
    label: 'Test label',
    times: [{ time: '07:30', label: 'Test slot one' }, { time: '08:30' }],
    note: 'Test note',
    notify: false,
  };
  const send = (method: 'post' | 'patch' | 'put' | 'delete', path: string, body?: object, cookie = adminCookie) => {
    const call = request(app())[method](`/api/admin/masjids${path}`).set('Cookie', cookie).set(CSRF);
    return body === undefined ? call : call.send(body);
  };
  const status = (response: request.Response) => ({
    status: response.status,
    code: (response.body as { code?: string }).code,
  });

  it('add → list → replace → delete; the list starts 30 days back and leaves deleted entries out', async () => {
    const created = await send('post', `/${own}/special`, ENTRY);
    expect(created.status).toBe(201);
    const { id, item } = specialDateSavedSchema.parse(created.body);
    expect(item).toBeNull();
    const old = specialDateSavedSchema.parse(
      (await send('post', `/${own}/special`, { ...ENTRY, date: '2026-09-15' })).body, // 31 days back
    ).id;

    const list = adminSpecialDatesSchema.parse((await get(`/${own}/special`)).body).specialDates;
    const { notify: _notify, ...stored } = ENTRY;
    expect(list.find((entry) => entry.id === id)).toEqual({ id, ...stored });
    expect(list.some((entry) => entry.id === old)).toBe(false);

    const replaced = await send('patch', `/${own}/special/${id}`, {
      type: 'taraweeh',
      date: '2026-10-21',
      times: [{ time: '21:30' }],
      notify: false,
    });
    expect(replaced.status).toBe(200);
    const after = adminSpecialDatesSchema.parse((await get(`/${own}/special`)).body).specialDates;
    expect(after.find((entry) => entry.id === id)).toEqual({
      id,
      type: 'taraweeh',
      date: '2026-10-21',
      times: [{ time: '21:30' }],
    });

    expect((await send('delete', `/${own}/special/${id}`)).status).toBe(204);
    const gone = adminSpecialDatesSchema.parse((await get(`/${own}/special`)).body).specialDates;
    expect(gone.some((entry) => entry.id === id)).toBe(false);
    expect(status(await send('delete', `/${own}/special/${id}`))).toEqual({
      status: 404,
      code: 'SPECIAL_DATE_NOT_FOUND',
    });
  });

  it('refuses bad input: contract rules (400 VALIDATION_FAILED) and the domain rules (400 SPECIAL_DATE_INVALID)', async () => {
    for (const body of [
      { ...ENTRY, times: [] },
      { ...ENTRY, times: Array.from({ length: 6 }, (_, i) => ({ time: `0${String(i + 1)}:00` })) },
      { ...ENTRY, type: 'birthday' },
      { ...ENTRY, times: [{ time: '25:00' }] },
      { ...ENTRY, label: 'x'.repeat(81) },
      { ...ENTRY, times: [{ time: '07:30', label: 'x'.repeat(41) }] },
      { ...ENTRY, note: 'x'.repeat(301) },
      { ...ENTRY, label: `Test${String.fromCodePoint(0x202e)}label` }, // bidi override (04 §6)
      { ...ENTRY, extra: true }, // strict
    ]) {
      expect(status(await send('post', `/${own}/special`, body))).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
    }
    for (const body of [
      { ...ENTRY, times: [{ time: '07:30' }, { time: '07:30' }] },
      { ...ENTRY, date: '2027-11-21' }, // 2026-10-16 + 401
    ]) {
      expect(status(await send('post', `/${own}/special`, body))).toEqual({
        status: 400,
        code: 'SPECIAL_DATE_INVALID',
      });
    }
  });

  it('another masjid, a malformed id and a non-member get 404; notify publishes a timing update', async () => {
    expect(status(await send('post', `/${other}/special`, ENTRY))).toEqual({ status: 404, code: 'MASJID_NOT_FOUND' });
    expect(status(await get(`/${other}/special`))).toEqual({ status: 404, code: 'MASJID_NOT_FOUND' });
    expect(status(await get(`/${own}/special`, superCookie))).toEqual({ status: 404, code: 'MASJID_NOT_FOUND' });
    expect(status(await send('patch', `/${own}/special/not-a-uuid`, ENTRY))).toEqual({
      status: 404,
      code: 'SPECIAL_DATE_NOT_FOUND',
    });
    const used = pushQuotaSchema.parse((await get(`/${own}/notifications/quota`)).body).used;
    const notified = await send('post', `/${own}/special`, { ...ENTRY, notify: true });
    expect(specialDateSavedSchema.parse(notified.body).item?.publicId).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(pushQuotaSchema.parse((await get(`/${own}/notifications/quota`)).body).used).toBe(used + 1);
  });

  it('Ramadan: off by default; on with precautions; off again keeps them; bad ranges refused', async () => {
    expect(ramadanSchema.parse((await get(`/${own}/ramadan`)).body)).toEqual({
      start: null,
      end: null,
      sehriPrecaution: 0,
      iftarPrecaution: 0,
    });
    const on = { start: '2027-02-08', end: '2027-03-09', sehriPrecaution: 10, iftarPrecaution: 3 };
    const saved = await send('put', `/${own}/ramadan`, on);
    expect(saved.status).toBe(200);
    expect(ramadanSchema.parse(saved.body)).toEqual(on);
    expect(ramadanSchema.parse((await get(`/${own}/ramadan`)).body)).toEqual(on);
    const off = await send('put', `/${own}/ramadan`, { ...on, start: null, end: null });
    expect(ramadanSchema.parse(off.body)).toEqual({ ...on, start: null, end: null });

    for (const body of [
      { ...on, end: null },
      { ...on, sehriPrecaution: 16 },
      { ...on, iftarPrecaution: 11 },
      { ...on, iftarPrecaution: 1.5 },
    ]) {
      expect(status(await send('put', `/${own}/ramadan`, body))).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
    }
    for (const body of [
      { ...on, start: '2027-03-09', end: '2027-02-08' },
      { ...on, end: '2027-03-10' }, // 31 days
    ]) {
      expect(status(await send('put', `/${own}/ramadan`, body))).toEqual({ status: 400, code: 'RAMADAN_INVALID' });
    }
    expect(status(await send('put', `/${other}/ramadan`, on))).toEqual({ status: 404, code: 'MASJID_NOT_FOUND' });
  });
});

describe('photo upload (T3.6)', () => {
  const upload = (
    bytes: Buffer,
    query = '?purpose=announcement&rightsConfirmed=true',
    path = own,
    name = 'photo.jpg',
  ) =>
    request(app())
      .post(`/api/admin/masjids/${path}/images${query}`)
      .set('Cookie', adminCookie)
      .set(CSRF)
      .attach('file', bytes, name);
  const photo = () =>
    sharp({ create: { width: 2000, height: 1000, channels: 3, background: { r: 10, g: 90, b: 60 } } })
      .jpeg()
      .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '17/1 23/1 0/1' } })
      .toBuffer();

  it('stores a sanitized master + variants and answers its key, ThumbHash and delivery URLs; audited with the rights tick', async () => {
    const response = await upload(await photo());
    expect(response.status).toBe(201);
    const body = imageUploadedSchema.parse(response.body);
    expect(body.imageKey).toMatch(new RegExp(`^m/${own}/[0-9a-f-]{36}$`));
    expect({ width: body.width, height: body.height }).toEqual({ width: 1440, height: 720 });
    expect(body.urls.w960).toBe(`https://media.test/i/960/webp/${body.imageKey}`);
    const master = await readFile(join(mediaDir, 'masters', `${body.imageKey}.jpg`));
    expect((await sharp(master).metadata()).exif).toBeUndefined();
    const audit = await test?.db.collection('audit_log').findOne({
      action: 'image.upload',
      target_id: body.imageKey.split('/').at(-1),
    });
    expect(audit).toMatchObject({ meta: { purpose: 'announcement', rights_confirmed: true } });
  });

  it('refuses: no rights tick or bad purpose (400), not a photo / HEIC (422), over 10 MB (413), another masjid (404)', async () => {
    const jpeg = await photo();
    for (const query of [
      '?purpose=announcement',
      '?purpose=announcement&rightsConfirmed=false',
      '?purpose=avatar&rightsConfirmed=true',
    ]) {
      expect((await upload(jpeg, query)).status).toBe(400);
    }
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    expect((await upload(html, undefined, own, 'photo.jpg')).body).toMatchObject({
      status: 422,
      code: 'IMAGE_INVALID',
    });
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(64)]);
    expect((await upload(heic)).body).toMatchObject({ code: 'IMAGE_INVALID' });
    expect((await upload(Buffer.alloc(10 * 1024 * 1024 + 1, 0xff))).status).toBe(413);
    expect((await upload(jpeg, undefined, other)).body).toMatchObject({ status: 404, code: 'MASJID_NOT_FOUND' });
    const json = await request(app())
      .post(`/api/admin/masjids/${own}/images?purpose=announcement&rightsConfirmed=true`)
      .set('Cookie', adminCookie)
      .set(CSRF)
      .send({ file: 'x' });
    expect(json.status).toBe(415);
  });
});
