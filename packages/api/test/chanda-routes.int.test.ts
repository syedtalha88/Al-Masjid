// PHASE_05 T5.5 (API) — weekly chanda over HTTP as api-admin's own database user: strict bodies and every rule → 400 /
// 409; save a week → its feed item; the same week again → updated, not new; "Show chanda to followers" through the
// settings route; and the public API (api-public's view user) never returns a hidden week — bundle, feed, item link.
// Fake amounts only.
import { processUserHandle } from '@mc/db/testing';
import { adminChandaSchema, chandaWeekSavedSchema, masjidBundleSchema } from '@mc/shared/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPublicApp } from '../src/app.ts';
import { deviceAuthenticator } from '../src/auth/device.ts';
import { memoryRateLimiter } from '../src/http/rate-limit.ts';
import { apiPublicRoutes } from '../src/routes/index.ts';
import { silentLogger } from './helpers.ts';
import { CSRF, superHarness } from './super-harness.ts';

// 2026-11-10 is a Tuesday (IST): the Friday week started 2026-11-06.
const harness = superHarness('chanda_routes', new Date('2026-11-10T06:30:00Z'));
const { app, asSuper, register, testDatabase, clock } = harness;
let asPublic: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let publicServer: ReturnType<typeof createPublicApp>['app'] | undefined;
/** api-public as its own database user (the `v_pub_*` views only). */
const publicApp = () => {
  if (!publicServer) throw new Error('no public app');
  return publicServer;
};

let masjidId = '';
let cookie = '';
const offset = (jamaatOffsetMin: number) => ({
  adhanMode: 'auto',
  adhanAdjustMin: 0,
  jamaatMode: 'offset',
  jamaatOffsetMin,
});
const admin = (method: 'get' | 'put' | 'patch', path: string) => {
  const built = request(app())[method](`/api/admin/masjids/${masjidId}/chanda${path}`).set('Cookie', cookie);
  return method === 'get' ? built : built.set(CSRF);
};
const codeOf = (response: request.Response) => (response.body as { code?: string }).code;

/** What a follower's app can read: the bundle's chanda and the feed's chanda items. */
async function publicView() {
  const versions = await request(publicApp()).get(`/api/v1/masjids/versions?ids=${masjidId}`);
  const v = (versions.body as Record<string, { v: number }>)[masjidId]?.v ?? 0;
  const bundle = masjidBundleSchema.parse(
    (await request(publicApp()).get(`/api/v1/masjids/${masjidId}/bundle?v=${String(v)}`)).body,
  );
  const feed = await request(publicApp()).get(
    `/api/v1/masjids/${masjidId}/feed?v=${String(v)}&type=chanda_update&aud=brothers`,
  );
  return {
    chanda: bundle.status === 'active' ? bundle.chanda : 'suspended',
    feed: (feed.body as { items: { publicId: string; chanda?: unknown }[] }).items,
  };
}

afterAll(async () => {
  await asPublic?.dispose();
});

beforeAll(async () => {
  asPublic = await processUserHandle(testDatabase(), 'mc_public');
  publicServer = createPublicApp({
    logger: silentLogger(),
    release: 't',
    trustedProxyMode: 'none',
    clock,
    rateLimiter: memoryRateLimiter(),
    authenticateDevice: deviceAuthenticator({ db: asPublic.handle, clock }),
    routes: apiPublicRoutes({ db: asPublic.handle, turnstile: () => Promise.resolve(true) }),
  }).app;
  const masjid = await asSuper('post', '/masjids').send({
    name: 'Test Masjid Chanda',
    area: 'Test Area',
    city: 'Hyderabad',
    state: 'Telangana',
    address: 'Test address',
    lat: 17.385,
    lng: 78.4867,
  });
  masjidId = (masjid.body as { id: string }).id;
  const invited = await asSuper('post', '/admins').send({
    displayName: 'Test Imam',
    uiLocale: 'en',
    masjidId,
    role: 'owner',
  });
  cookie = await register((invited.body as { inviteUrl: string }).inviteUrl);
  const settings = await asSuper('get', '/settings');
  const version = (settings.body as { undertakingVersion: string }).undertakingVersion;
  await request(app()).post('/api/admin/auth/undertaking').set(CSRF).set('Cookie', cookie).send({ version });
  await request(app())
    .put(`/api/admin/masjids/${masjidId}/timings`)
    .set('Cookie', cookie)
    .set(CSRF)
    .set('If-Match', '"0"')
    .send({
      prayers: { fajr: offset(20), dhuhr: offset(15), asr: offset(15), maghrib: offset(5), isha: offset(15) },
      jumuah: [{ seq: 1, jamaatTime: '13:30' }],
      notify: false,
    });
  expect((await asSuper('post', `/masjids/${masjidId}/activate`)).status).toBe(204);
});

describe('weekly chanda (B9)', () => {
  it('validates strictly: bodies, the week-start day, future weeks, notify while hidden', async () => {
    for (const [week, body, status, code] of [
      ['2026-11-06', { amountPaise: 1.5, notify: false }, 400, 'VALIDATION_FAILED'],
      ['2026-11-06', { amountPaise: 100, notify: false, extra: 1 }, 400, 'VALIDATION_FAILED'],
      ['2026-11-06', { amountPaise: 100, note: 'x'.repeat(201), notify: false }, 400, 'VALIDATION_FAILED'],
      ['2026-11-07', { amountPaise: 100, notify: false }, 400, 'CHANDA_INVALID'], // a Saturday
      ['2026-11-13', { amountPaise: 100, notify: false }, 400, 'CHANDA_INVALID'], // next week
      ['not-a-day', { amountPaise: 100, notify: false }, 400, 'CHANDA_INVALID'],
      ['2026-11-06', { amountPaise: 100, notify: true }, 409, 'CHANDA_HIDDEN'],
    ] as const) {
      const response = await admin('put', `/${week}`).send(body);
      expect([response.status, codeOf(response)], `${week} ${JSON.stringify(body)}`).toEqual([status, code]);
    }
    const settings = await admin('patch', '/settings').send({ weekStart: 9 });
    expect([settings.status, codeOf(settings)]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it('saves a week (new), again (updated); hidden weeks never reach the public API', async () => {
    const first = await admin('put', '/2026-11-06').send({ amountPaise: 1_850_000, note: 'Test note', notify: false });
    expect(first.status).toBe(200);
    const saved = chandaWeekSavedSchema.parse(first.body);
    expect(saved).toMatchObject({ created: true, notification: null });
    const again = await admin('put', '/2026-11-06').send({ amountPaise: 1_900_000, notify: false });
    expect(chandaWeekSavedSchema.parse(again.body)).toMatchObject({ created: false, item: saved.item });
    expect(await publicView()).toEqual({ chanda: null, feed: [] });
    const link = await request(publicApp()).get(`/api/v1/items/${saved.item.publicId}?aud=brothers`);
    expect(link.status).toBe(404);
  });

  it('shown: the bundle and the feed have the week; notify now allowed; hidden again → gone', async () => {
    expect((await admin('patch', '/settings').send({ show: true })).status).toBe(204);
    const shown = await publicView();
    expect(shown.chanda).toEqual({ weeks: [{ weekStart: '2026-11-06', amountPaise: 1_900_000 }] });
    expect(shown.feed.map((item) => item.chanda)).toEqual([{ weekStart: '2026-11-06', amountPaise: 1_900_000 }]);
    const notified = await admin('put', '/2026-10-30').send({ amountPaise: 1_200_000, notify: true });
    expect(chandaWeekSavedSchema.parse(notified.body).notification).toMatchObject({ queued: true });
    const listed = adminChandaSchema.parse((await admin('get', '')).body);
    expect(listed).toMatchObject({ show: true, weekStart: 5 });
    expect(listed.weeks.map((week) => week.weekStart)).toEqual(['2026-11-06', '2026-10-30']);
    expect((await admin('patch', '/settings').send({ show: false })).status).toBe(204);
    expect(await publicView()).toEqual({ chanda: null, feed: [] });
    const nothing = await admin('patch', '/settings').send({});
    expect([nothing.status, codeOf(nothing)]).toEqual([400, 'NOTHING_TO_UPDATE']);
  });
});
