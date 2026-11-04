// PHASE_03 T3.1 (API) against a migrated MongoDB as the real mc_admin user: the masjid-scoped Admin Home reads —
// stats, push quota, schedule — for the admin's own masjid; another masjid, a malformed id and the Super Admin (not a
// member) all get the uniform 404; no session → 401. T3.2: the timings editor; T3.3: special dates and Ramadan; T3.9: My
// Posts (list, edit within 24 h with If-Match, delete); T3.6:
// photos, the template list and publishing a notice.
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
  adminItemListSchema,
  adminMasjidProfileSchema,
  adminMasjidStatsSchema,
  adminScheduleSchema,
  adminSpecialDatesSchema,
  audioUploadedSchema,
  imageUploadedSchema,
  itemEditedSchema,
  itemPublishedSchema,
  pushQuotaSchema,
  ramadanSchema,
  specialDateSavedSchema,
  superDashboardSchema,
  templateListSchema,
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

describe('notices (T3.6)', () => {
  const publish = (body: object, path = own) =>
    request(app())
      .post(`/api/admin/masjids/${path}/items/announcement`)
      .set('Cookie', adminCookie)
      .set(CSRF)
      .send(body);
  const NOTICE = {
    content: { kind: 'template', key: 'no_water_time_range', params: { hours: { start: '10:00', end: '14:00' } } },
    category: 'facilities',
    isImportant: true,
    notify: false,
  };

  beforeAll(async () => {
    // A fresh database has no templates: add the starters (draft) and activate the one used here, as the Super Admin.
    const asSuper = (method: 'post' | 'patch', path: string, body?: object) => {
      const call = request(app())[method](`/api/super${path}`).set('Cookie', superCookie).set(CSRF);
      return body === undefined ? call : call.send(body);
    };
    expect((await asSuper('post', '/templates/starters')).status).toBe(200);
    const activate = await asSuper('patch', '/templates/no_water_time_range', {
      translationReviewed: true,
      status: 'active',
    });
    expect(activate.status).toBe(200);
  });

  it('lists the templates an admin may pick: active ones only, no system ones', async () => {
    const response = await get(`/${own}/templates`);
    expect(response.status).toBe(200);
    const keys = templateListSchema.parse(response.body).templates.map((entry) => entry.key);
    expect(keys).toEqual(['no_water_time_range']);
    expect((await get(`/${other}/templates`)).status).toBe(404);
  });

  it('publishes a template notice (201) without notifying: item ids, no notification', async () => {
    const response = await publish(NOTICE);
    expect(response.status).toBe(201);
    const body = itemPublishedSchema.parse(response.body);
    expect(body.notification).toBeNull();
    expect(body.item.publicId).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('notify: queued, followers targeted, quota left — and the quota pill moves', async () => {
    const before = pushQuotaSchema.parse((await get(`/${own}/notifications/quota`)).body);
    const response = await publish({ ...NOTICE, notify: true });
    expect(response.status).toBe(201);
    expect(itemPublishedSchema.parse(response.body).notification).toEqual({
      queued: true,
      targeted: 0,
      quotaLeft: before.limit - before.used - 1,
    });
    const after = pushQuotaSchema.parse((await get(`/${own}/notifications/quota`)).body);
    expect(after.used).toBe(before.used + 1);
  });

  it('own text: limits enforced by the contract; content_locale stored', async () => {
    const text = (title: string, body: string, extra: object = {}) =>
      publish({ ...NOTICE, content: { kind: 'text', title, body, locale: 'te', ...extra } });
    const ok = await text('Test title', 'Test body');
    expect(ok.status).toBe(201);
    const { item } = itemPublishedSchema.parse(ok.body);
    expect(await test?.db.collection('items').findOne({ public_id: item.publicId })).toMatchObject({
      title: 'Test title',
      body: 'Test body',
      content_locale: 'te',
    });
    for (const response of [
      await text('x'.repeat(81), 'Test body'),
      await text('Test title', 'x'.repeat(1001)),
      await text('', 'Test body'),
      await text('Test title', 'Test body', { locale: 'fr' }),
      await text('Test‮title', 'Test body'),
    ]) {
      expect(response.body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    }
    expect((await text('x'.repeat(80), 'x'.repeat(1000))).status).toBe(201);
  });

  it('refuses: bad params (ANNOUNCEMENT_INVALID), unknown or draft templates (404), photos of another masjid or without the tick, an event time off an event', async () => {
    const withParams = (params: object) => publish({ ...NOTICE, content: { ...NOTICE.content, params } });
    expect((await withParams({})).body).toMatchObject({ status: 400, code: 'ANNOUNCEMENT_INVALID' });
    expect((await withParams({ hours: { start: '10:00', end: '10:00' } })).body).toMatchObject({
      code: 'ANNOUNCEMENT_INVALID',
    });
    for (const key of ['general_thanks', 'timings_updated', 'no_such_template']) {
      expect((await publish({ ...NOTICE, content: { kind: 'template', key, params: {} } })).body).toMatchObject({
        status: 404,
        code: 'TEMPLATE_NOT_FOUND',
      });
    }
    const photo = (masjid: string, extra: object = { rightsConfirmed: true }) => ({
      key: `m/${masjid}/0b7f6c2e-1d4a-4f3b-9c8e-2a1b3c4d5e6f`,
      thumbhash: 'AAAA',
      ...extra,
    });
    expect((await publish({ ...NOTICE, image: photo(other) })).body).toMatchObject({ code: 'ANNOUNCEMENT_INVALID' });
    expect((await publish({ ...NOTICE, image: photo(own, {}) })).body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await publish({ ...NOTICE, image: { ...photo(own), key: 'seed/x' } })).body).toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect((await publish({ ...NOTICE, image: photo(own) })).status).toBe(201);
    expect((await publish({ ...NOTICE, eventAt: '2026-10-20T10:00:00Z' })).body).toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect((await publish({ ...NOTICE, category: 'event', eventAt: '2026-10-20T10:00:00Z' })).status).toBe(201);
  });

  it('another masjid and a malformed id: 404; no session: 401', async () => {
    expect((await publish(NOTICE, other)).body).toMatchObject({ status: 404, code: 'MASJID_NOT_FOUND' });
    expect((await publish(NOTICE, 'not-an-id')).body).toMatchObject({ status: 404, code: 'MASJID_NOT_FOUND' });
    const anonymous = await request(app()).post(`/api/admin/masjids/${own}/items/announcement`).set(CSRF).send(NOTICE);
    expect(anonymous.status).toBe(401);
  });
});

describe('My Posts (T3.9): list, edit within 24 h, delete', () => {
  const NOTICE_TEXT = {
    content: { kind: 'text', title: 'Test post title', body: 'Test post body', locale: 'en' },
    category: 'general',
    isImportant: false,
  };
  const publishText = async () => {
    const response = await request(app())
      .post(`/api/admin/masjids/${own}/items/announcement`)
      .set('Cookie', adminCookie)
      .set(CSRF)
      .send({ ...NOTICE_TEXT, notify: false });
    expect(response.status).toBe(201);
    return itemPublishedSchema.parse(response.body).item;
  };
  const list = async (query = '') => {
    const response = await get(`/${own}/items${query}`);
    expect(response.status).toBe(200);
    return adminItemListSchema.parse(response.body);
  };
  const patch = (itemId: string, ifMatch: string | null, body: object) => {
    const call = request(app()).patch(`/api/admin/masjids/${own}/items/${itemId}`).set('Cookie', adminCookie).set(CSRF);
    return (ifMatch === null ? call : call.set('If-Match', `"${ifMatch}"`)).send(body);
  };
  const EDIT = {
    type: 'announcement',
    ...NOTICE_TEXT,
    content: { ...NOTICE_TEXT.content, title: 'Test edited title' },
  };

  it('lists the post with its If-Match value and edit window; an edit within 24 h is saved', async () => {
    const item = await publishText();
    const row = (await list()).items.find((entry) => entry.id === item.id);
    expect(row).toMatchObject({ status: 'published', item: { title: 'Test post title', type: 'announcement' } });
    expect(row?.editableUntil).toBe(new Date(clock.now().getTime() + 24 * 60 * 60 * 1000).toISOString());
    const saved = await patch(item.id, row?.updatedAt ?? '', EDIT);
    expect(saved.status).toBe(200);
    expect(itemEditedSchema.parse(saved.body).updatedAt).toBe(clock.now().toISOString());
    const after = (await list()).items.find((entry) => entry.id === item.id);
    expect(after?.item).toMatchObject({ title: 'Test edited title', editedAt: clock.now().toISOString() });
  });

  it('If-Match: stale → 412, missing → 400; a body of another type → 409 ITEM_NOT_EDITABLE; bad bodies → 400', async () => {
    const item = await publishText();
    const row = (await list()).items.find((entry) => entry.id === item.id);
    const updatedAt = row?.updatedAt ?? '';
    expect((await patch(item.id, '2026-01-01T00:00:00.000Z', EDIT)).body).toMatchObject({
      status: 412,
      code: 'PRECONDITION_FAILED',
    });
    expect((await patch(item.id, null, EDIT)).status).toBe(400);
    expect(
      (await patch(item.id, updatedAt, { type: 'daily_content', libraryId: '0b7f6c2e-1d4a-4f3b-9c8e-2a1b3c4d5e6f' }))
        .body,
    ).toMatchObject({ status: 409, code: 'ITEM_NOT_EDITABLE' });
    for (const body of [
      { ...EDIT, notify: true },
      { ...EDIT, type: 'video' },
      { ...EDIT, eventAt: clock.now().toISOString() },
    ]) {
      expect((await patch(item.id, updatedAt, body)).body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    }
  });

  it('after 24 h: 409 EDIT_WINDOW_CLOSED and no edit window in the list (T3.9 acceptance)', async () => {
    const item = await publishText();
    const dayAgo = new Date(clock.now().getTime() - 24 * 60 * 60 * 1000 - 60_000);
    await test?.db.collection('items').updateOne({ public_id: item.publicId }, { $set: { published_at: dayAgo } });
    const row = (await list()).items.find((entry) => entry.id === item.id);
    expect(row).not.toHaveProperty('editableUntil');
    expect((await patch(item.id, row?.updatedAt ?? '', EDIT)).body).toMatchObject({
      status: 409,
      code: 'EDIT_WINDOW_CLOSED',
    });
  });

  it('delete → 204 (again 204); the list shows it deleted; filters; another masjid and bad ids → 404', async () => {
    const item = await publishText();
    const remove = (itemId: string, masjid = own) =>
      request(app()).delete(`/api/admin/masjids/${masjid}/items/${itemId}`).set('Cookie', adminCookie).set(CSRF);
    expect((await remove(item.id)).status).toBe(204);
    expect((await remove(item.id)).status).toBe(204);
    const deleted = await list('?status=deleted');
    expect(deleted.items.find((entry) => entry.id === item.id)).toMatchObject({ status: 'deleted' });
    expect((await list('?type=daily_content')).items.every((entry) => entry.item.type === 'daily_content')).toBe(true);
    expect((await get(`/${own}/items?status=hidden`)).status).toBe(400);
    expect((await remove('not-an-id')).body).toMatchObject({ status: 404, code: 'ITEM_NOT_FOUND' });
    expect((await remove(item.id, other)).status).toBe(404);
    expect((await get(`/${other}/items`)).status).toBe(404);
  });
});

describe('Masjid Profile (T3.10): photo, Hijri adjustment, change requests; nothing else can change', () => {
  const patch = (body: unknown, path = own) =>
    request(app())
      .patch(`/api/admin/masjids/${path}`)
      .set('Cookie', adminCookie)
      .set(CSRF)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body));
  const profile = async () => {
    const response = await get(`/${own}`);
    expect(response.status).toBe(200);
    return adminMasjidProfileSchema.parse(response.body);
  };

  it('reads the profile; sets and clears the Hijri adjustment', async () => {
    const before = await profile();
    expect(before).toMatchObject({ id: own, name: 'Test Masjid Own', hijriOffset: null, globalHijriOffset: 0 });
    const set = await patch({ hijriOffset: 1 });
    expect(set.status).toBe(200);
    expect(adminMasjidProfileSchema.parse(set.body).hijriOffset).toBe(1);
    expect(adminMasjidProfileSchema.parse((await patch({ hijriOffset: null })).body).hijriOffset).toBeNull();
    expect((await get(`/${other}`)).status).toBe(404);
    expect((await patch({ hijriOffset: 1 }, other)).status).toBe(404);
  });

  it('crafted payloads are refused (T3.10 acceptance): other fields, $-operators, dotted keys, out of range', async () => {
    const before = await test?.db.collection('masjids').findOne({ name: 'Test Masjid Own' });
    for (const body of [
      { name: 'Test renamed' },
      { hijriOffset: 1, name: 'Test renamed' },
      { hijriOffset: 1, status: 'active' },
      { $set: { name: 'Test renamed' } },
      { hijriOffset: 1, $set: { name: 'Test renamed' } },
      { 'name_i18n.ur': 'Test name' },
      { hijriOffset: { $gt: 0 } },
      { hijriOffset: 3 },
      { hijriOffset: '1' },
      {},
      [{ hijriOffset: 1 }],
    ]) {
      const response = await patch(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    const after = await test?.db.collection('masjids').findOne({ name: 'Test Masjid Own' });
    expect(after?.['name']).toBe(before?.['name']);
    expect(after?.['status']).toBe(before?.['status']);
    expect(after?.['name_i18n']).toEqual(before?.['name_i18n']);
  });

  it('changes the photo through the pipeline (rights tick required); the profile answers its URL', async () => {
    const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 90, b: 60 } } })
      .jpeg()
      .toBuffer();
    const upload = (query: string) =>
      request(app())
        .post(`/api/admin/masjids/${own}/photo${query}`)
        .set('Cookie', adminCookie)
        .set(CSRF)
        .attach('file', bytes, 'photo.jpg');
    expect((await upload('')).status).toBe(400);
    const response = await upload('?rightsConfirmed=true');
    expect(response.status).toBe(200);
    const body = adminMasjidProfileSchema.parse(response.body);
    expect(body.photo?.key).toMatch(new RegExp(`^m/${own}/[0-9a-f-]{36}$`));
    expect(body.photo?.url).toBe(`https://media.test/i/960/webp/${body.photo?.key ?? ''}`);
    expect(
      await test?.db.collection('audit_log').findOne({ action: 'image.upload', 'meta.purpose': 'masjid' }),
    ).not.toBeNull();
  });

  it('a change request reaches the Super Admin dashboard', async () => {
    const sent = await request(app())
      .post(`/api/admin/masjids/${own}/change-requests`)
      .set('Cookie', adminCookie)
      .set(CSRF)
      .send({ note: 'Test note: please fix the Telugu name.' });
    expect(sent.status).toBe(204);
    expect(
      (
        await request(app())
          .post(`/api/admin/masjids/${own}/change-requests`)
          .set('Cookie', adminCookie)
          .set(CSRF)
          .send({ note: '' })
      ).status,
    ).toBe(400);
    const dashboard = await request(app()).get('/api/super/dashboard').set('Cookie', superCookie);
    expect(dashboard.status).toBe(200);
    expect(superDashboardSchema.parse(dashboard.body).changeRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          masjidId: own,
          masjidName: 'Test Masjid Own',
          note: 'Test note: please fix the Telugu name.',
        }),
      ]),
    );
  });
});

describe('voice notes (T3.13): POST /audio', () => {
  const PEAKS = Array.from({ length: 48 }, (_, index) => (index * 5) % 256);
  const OGG = Buffer.concat([Buffer.from('OggS', 'latin1'), Buffer.alloc(64)]);
  const upload = (bytes: Buffer, query: string, path = own) =>
    request(app())
      .post(`/api/admin/masjids/${path}/audio${query}`)
      .set('Cookie', adminCookie)
      .set(CSRF)
      .attach('file', bytes, 'voice.ogg');
  const good = `?rightsConfirmed=true&durationS=12.4&peaks=${PEAKS.join(',')}`;

  it('stores the recording; answers its key, whole seconds and the waveform; audited with the rights tick', async () => {
    const response = await upload(OGG, good);
    expect(response.status).toBe(201);
    const body = audioUploadedSchema.parse(response.body);
    expect(body).toEqual({
      audioKey: expect.stringMatching(new RegExp(`^m/${own}/a/[0-9a-f-]{36}$`)) as unknown,
      durationS: 12,
      peaks: PEAKS,
    });
    expect(await readFile(join(mediaDir, 'a', 'm4a', body.audioKey))).toEqual(OGG);
    expect(await test?.db.collection('audit_log').findOne({ action: 'audio.upload' })).toMatchObject({
      meta: { duration_s: 12, rights_confirmed: true },
    });
  });

  it('refuses what is not audio (422), no rights tick / bad length / bad peaks (400), another masjid (404)', async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
    expect((await upload(jpeg, good)).body).toMatchObject({ status: 422, code: 'AUDIO_INVALID' });
    for (const query of [
      `?durationS=12&peaks=${PEAKS.join(',')}`,
      `?rightsConfirmed=true&durationS=601&peaks=${PEAKS.join(',')}`,
      `?rightsConfirmed=true&durationS=12&peaks=1,2,3`,
    ]) {
      expect((await upload(OGG, query)).status, query).toBe(400);
    }
    expect((await upload(OGG, good, other)).status).toBe(404);
  });
});
