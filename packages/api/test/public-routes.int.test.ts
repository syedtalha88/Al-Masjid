// PHASE_02 T2.2 — every api-public endpoint against a migrated, seeded MongoDB, as the REAL mc_public user
// (DECISIONS #78): success, validation, auth, rate limits, cache headers + Cache-Tag, version redirects, audience
// filtering, suspended masjids, idempotency and NoSQL-injection shapes.
import { idText, parseId } from '@mc/db';
import { runMigrations } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';
import { SEED_FOLLOW_CODES, seedId, seedPublicId } from '@mc/db/seed';
import { createTestDatabase, processUserHandle, type TestDatabase } from '@mc/db/testing';
import { ManualClock } from '@mc/shared/clock';
import {
  deviceRecordSchema,
  feedPageSchema,
  itemDetailSchema,
  masjidBundleSchema,
  registerDeviceResponseSchema,
} from '@mc/shared/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPublicApp } from '../src/app.ts';
import { deviceAuthenticator } from '../src/auth/device.ts';
import { memoryRateLimiter } from '../src/http/rate-limit.ts';
import { ensureDevSeed, runDevSeed, SEED_REFRESH_MS } from '../src/jobs/seed.ts';
import { apiPublicRoutes } from '../src/routes/index.ts';
import { CACHE } from '../src/routes/public.ts';
import { silentLogger } from './helpers.ts';

type Raw = { _id: NonNullable<ReturnType<typeof parseId>> } & Record<string, unknown>;

const NOW = new Date('2026-10-22T06:30:00Z');
const clock = new ManualClock(NOW);
const ALPHA = idText(seedId('masjid-alpha'));
const BETA = idText(seedId('masjid-beta'));
const GAMMA = idText(seedId('masjid-gamma'));

let test: TestDatabase | undefined;
let asPublic: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};

const buildApp = (buckets: Parameters<typeof memoryRateLimiter>[0] = {}) => {
  if (!asPublic) throw new Error('no mc_public handle');
  const db = asPublic.handle;
  return createPublicApp({
    logger: silentLogger(),
    release: 't',
    trustedProxyMode: 'none',
    clock,
    rateLimiter: memoryRateLimiter(buckets),
    authenticateDevice: deviceAuthenticator({ db, clock }),
    routes: apiPublicRoutes({ db, turnstile: (token) => Promise.resolve(token === 'turnstile-ok') }),
  }).app;
};
let appInstance: ReturnType<typeof buildApp> | undefined;
const app = () => {
  appInstance ??= buildApp();
  return appInstance;
};

const REGISTER: {
  locale: string;
  audiencePref: string;
  platform: string;
  privacyVersion: string;
  turnstileToken: string;
} = {
  locale: 'en',
  audiencePref: 'brothers',
  platform: 'android',
  privacyVersion: 'draft-1',
  turnstileToken: 'turnstile-ok',
};

async function register(body: Partial<typeof REGISTER> = {}) {
  const response = await request(app())
    .post('/api/v1/devices')
    .send({ ...REGISTER, ...body });
  expect(response.status).toBe(201);
  const parsed = registerDeviceResponseSchema.parse(response.body);
  return { ...parsed, auth: `Device ${parsed.deviceId}.${parsed.secret}` };
}

const versionOf = async (masjidId: string) => {
  const response = await request(app()).get(`/api/v1/masjids/versions?ids=${masjidId}`);
  return Number((response.body as Record<string, { v: number }>)[masjidId]?.v);
};

beforeAll(async () => {
  test = await createTestDatabase('public-routes');
  await runMigrations(t().db, MIGRATIONS);
  asPublic = await processUserHandle(t(), 'mc_public');
  asSystem = await processUserHandle(t(), 'mc_system');
  await runDevSeed(asSystem.handle, 'local', NOW);
});

afterAll(async () => {
  await asPublic?.dispose();
  await asSystem?.dispose();
  await test?.dispose();
});

describe('GET /config', () => {
  it('returns the public settings, CDN-cacheable for a minute', async () => {
    const response = await request(app()).get('/api/v1/config');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe(CACHE.config);
    expect(response.body).toMatchObject({ globalHijriOffset: 0, legalVersions: { privacy: 'draft-1' } });
  });
});

describe('devices', () => {
  it('registers with Turnstile; the secret is returned once and never stored', async () => {
    const device = await register();
    expect(device.secret).toHaveLength(43);
    const stored = await t().db.collection<Raw>('devices').findOne({});
    expect(JSON.stringify(stored)).not.toContain(device.secret);
  });

  it('refuses a failed Turnstile check, and invalid bodies', async () => {
    const failed = await request(app())
      .post('/api/v1/devices')
      .send({ ...REGISTER, turnstileToken: 'bad' });
    expect(failed.status).toBe(403);
    expect(failed.body).toMatchObject({ code: 'TURNSTILE_FAILED' });
    for (const body of [
      { ...REGISTER, locale: 'fr' },
      { ...REGISTER, audiencePref: 'everyone' },
      { ...REGISTER, extra: 1 },
      { ...REGISTER, privacyVersion: 'x'.repeat(21) },
      { ...REGISTER, turnstileToken: '' },
    ]) {
      const response = await request(app()).post('/api/v1/devices').send(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    const injected = await request(app())
      .post('/api/v1/devices')
      .send({ ...REGISTER, locale: { $ne: 'x' } });
    expect(injected.status).toBe(400);
    expect(injected.body).toMatchObject({ code: 'UNSAFE_INPUT' });
  });

  it('rate-limits registration per IP (03 §2)', async () => {
    const limited = buildApp({ deviceRegisterIp: { points: 2, durationSec: 3600 } });
    for (let i = 0; i < 2; i += 1)
      expect((await request(limited).post('/api/v1/devices').send(REGISTER)).status).toBe(201);
    const refused = await request(limited).post('/api/v1/devices').send(REGISTER);
    expect(refused.status).toBe(429);
    expect(refused.headers['retry-after']).toMatch(/^\d+$/);
  });

  it('device auth: missing, malformed, unknown and wrong secrets are 401 DEVICE_AUTH_REQUIRED', async () => {
    const device = await register();
    const id = device.deviceId;
    for (const header of [
      undefined,
      'Device nope',
      `Bearer ${id}.${device.secret}`,
      `Device ${id}.${'A'.repeat(43)}`,
      `Device ${idText(seedId('nobody'))}.${device.secret}`,
      `Device ${id.toUpperCase()}.${device.secret}`,
    ]) {
      const call = request(app()).get('/api/v1/devices/me');
      const response = await (header === undefined ? call : call.set('Authorization', header));
      expect(response.status, header).toBe(401);
      expect(response.body).toMatchObject({ code: 'DEVICE_AUTH_REQUIRED' });
    }
  });

  it('GET/PATCH/DELETE /devices/me: what we store, preferences, Clear all data', async () => {
    const device = await register({ locale: 'te', platform: 'ios' });
    const me = await request(app()).get('/api/v1/devices/me').set('Authorization', device.auth);
    expect(me.status).toBe(200);
    expect(me.headers['cache-control']).toBe('no-store');
    expect(deviceRecordSchema.parse(me.body)).toMatchObject({ locale: 'te', platform: 'ios', pushEnabled: false });
    const patched = await request(app())
      .patch('/api/v1/devices/me')
      .set('Authorization', device.auth)
      .send({ audiencePref: 'sisters', locale: 'ur' });
    expect(patched.status).toBe(204);
    const after = await request(app()).get('/api/v1/devices/me').set('Authorization', device.auth);
    expect(after.body).toMatchObject({ audiencePref: 'sisters', locale: 'ur' });
    expect((await request(app()).patch('/api/v1/devices/me').set('Authorization', device.auth).send({})).status).toBe(
      400,
    );
    await request(app()).put(`/api/v1/devices/me/follows/${ALPHA}`).set('Authorization', device.auth);
    expect((await request(app()).delete('/api/v1/devices/me').set('Authorization', device.auth)).status).toBe(204);
    // The deleted device can no longer authenticate; its follows are gone.
    expect((await request(app()).get('/api/v1/devices/me').set('Authorization', device.auth)).status).toBe(401);
    expect(
      await t()
        .db.collection<Raw>('device_follows')
        .countDocuments({ device_id: parseId(device.deviceId) }),
    ).toBe(0);
  });
});

describe('GET /masjids/resolve/:code', () => {
  it('normalizes the code and returns the summary (cacheable 5 minutes)', async () => {
    for (const code of ['TESTA001', 'testa001', 'TEST-AOO1', 'test a001']) {
      const response = await request(app()).get(`/api/v1/masjids/resolve/${encodeURIComponent(code)}`);
      expect(response.status, code).toBe(200);
      expect(response.body).toMatchObject({ masjid: { id: ALPHA, followCode: SEED_FOLLOW_CODES.alpha } });
      expect(response.headers['cache-control']).toBe(CACHE.resolve);
    }
  });

  it('is a uniform 404 for malformed, unknown and suspended masjids', async () => {
    await t()
      .db.collection<Raw>('masjids')
      .updateOne({ _id: seedId('masjid-gamma') }, { $set: { status: 'suspended' } });
    try {
      for (const code of ['ZZZZZZZZ', 'nope', SEED_FOLLOW_CODES.gamma]) {
        const response = await request(app()).get(`/api/v1/masjids/resolve/${code}`);
        expect(response.status, code).toBe(404);
        expect(response.body).toMatchObject({ code: 'MASJID_NOT_FOUND' });
        expect(response.headers['cache-control']).toBe('no-store');
      }
    } finally {
      await t()
        .db.collection<Raw>('masjids')
        .updateOne({ _id: seedId('masjid-gamma') }, { $set: { status: 'active' } });
    }
  });

  it('is rate-limited per device, or per IP without one', async () => {
    const limited = buildApp({ codeResolve: { points: 2, durationSec: 60 } });
    for (let i = 0; i < 2; i += 1) {
      expect((await request(limited).get('/api/v1/masjids/resolve/TESTA001')).status).toBe(200);
    }
    expect((await request(limited).get('/api/v1/masjids/resolve/TESTA001')).status).toBe(429);
  });
});

describe('follows', () => {
  it('follow (idempotent), list, mute, unfollow', async () => {
    const device = await register();
    const put = () => request(app()).put(`/api/v1/devices/me/follows/${ALPHA}`).set('Authorization', device.auth);
    expect((await put()).body).toEqual({ status: 'followed' });
    expect((await put()).body).toEqual({ status: 'already' });
    const muted = await request(app())
      .patch(`/api/v1/devices/me/follows/${ALPHA}`)
      .set('Authorization', device.auth)
      .send({ muted: true });
    expect(muted.status).toBe(204);
    const list = await request(app()).get('/api/v1/devices/me/follows').set('Authorization', device.auth);
    expect(list.body).toMatchObject({ follows: [{ masjidId: ALPHA, muted: true }] });
    expect(
      (await request(app()).delete(`/api/v1/devices/me/follows/${ALPHA}`).set('Authorization', device.auth)).status,
    ).toBe(204);
    expect((await request(app()).get('/api/v1/devices/me/follows').set('Authorization', device.auth)).body).toEqual({
      follows: [],
    });
    // Muting a masjid the device does not follow, unknown ids, malformed ids.
    for (const id of [ALPHA, idText(seedId('nobody')), 'not-a-uuid']) {
      const response = await request(app())
        .patch(`/api/v1/devices/me/follows/${id}`)
        .set('Authorization', device.auth)
        .send({ muted: false });
      expect(response.status, id).toBe(404);
    }
    expect(
      (await request(app()).put(`/api/v1/devices/me/follows/not-a-uuid`).set('Authorization', device.auth)).status,
    ).toBe(404);
    expect((await request(app()).put(`/api/v1/devices/me/follows/${ALPHA}`)).status).toBe(401);
  });

  it('a suspended or unknown masjid cannot be followed; the 21st follow is FOLLOW_LIMIT_REACHED', async () => {
    const device = await register();
    expect(
      (
        await request(app())
          .put(`/api/v1/devices/me/follows/${idText(seedId('nobody'))}`)
          .set('Authorization', device.auth)
      ).body,
    ).toMatchObject({ code: 'MASJID_NOT_FOUND' });
    // Fill up to 20 directly, then follow through the API.
    const deviceId = parseId(device.deviceId);
    if (!deviceId) throw new Error('bad device id');
    await t()
      .db.collection<Raw>('devices')
      .updateOne({ _id: deviceId }, { $set: { follow_count: 20 } });
    const response = await request(app()).put(`/api/v1/devices/me/follows/${BETA}`).set('Authorization', device.auth);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'FOLLOW_LIMIT_REACHED' });
  });

  it('rate-limits follow changes per device', async () => {
    const limited = buildApp({ follow: { points: 1, durationSec: 3600 } });
    const device = await register();
    expect(
      (await request(limited).put(`/api/v1/devices/me/follows/${ALPHA}`).set('Authorization', device.auth)).status,
    ).toBe(200);
    expect(
      (await request(limited).put(`/api/v1/devices/me/follows/${BETA}`).set('Authorization', device.auth)).status,
    ).toBe(429);
  });
});

describe('versions, bundle, feed (01 §5.2 caching)', () => {
  it('versions: ≤ 20 ids; unknown ids absent; CDN 15 s + swr', async () => {
    const response = await request(app()).get(
      `/api/v1/masjids/versions?ids=${ALPHA},${BETA},${idText(seedId('none'))}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe(CACHE.versions);
    expect(Object.keys(response.body as object).sort()).toEqual([ALPHA, BETA].sort());
    expect((await request(app()).get('/api/v1/masjids/versions')).body).toEqual({});
    const tooMany = Array.from({ length: 21 }, (_, i) => idText(seedId(`v${String(i)}`))).join(',');
    expect((await request(app()).get(`/api/v1/masjids/versions?ids=${tooMany}`)).status).toBe(400);
    expect((await request(app()).get('/api/v1/masjids/versions?ids=x')).status).toBe(400);
    // `simple` query parser: bracket syntax is just a (rejected) key, never an operator.
    expect((await request(app()).get('/api/v1/masjids/versions?ids[$ne]=1')).status).toBe(400);
  });

  it('bundle: a stale or missing v redirects to the current one; the current one is immutable + Cache-Tag', async () => {
    const v = await versionOf(BETA);
    const stale = await request(app()).get(`/api/v1/masjids/${BETA}/bundle?v=1`);
    expect(stale.status).toBe(302);
    expect(stale.headers['location']).toBe(`/api/v1/masjids/${BETA}/bundle?v=${String(v)}`);
    expect(stale.headers['cache-control']).toBe(CACHE.redirect);
    expect((await request(app()).get(`/api/v1/masjids/${BETA}/bundle`)).status).toBe(302);
    const current = await request(app()).get(`/api/v1/masjids/${BETA}/bundle?v=${String(v)}`);
    expect(current.status).toBe(200);
    expect(current.headers['cache-control']).toBe(CACHE.immutable);
    expect(current.headers['cache-tag']).toBe(`m-${BETA}`);
    const bundle = masjidBundleSchema.parse(current.body);
    expect(bundle.status === 'active' && bundle.ramadan?.sehriPrecautionMin).toBe(5);
    expect(bundle.status === 'active' && bundle.timings?.jumuah).toEqual([
      { seq: 1, khutbahTime: '13:30', jamaatTime: '13:45' },
    ]);
    expect((await request(app()).get(`/api/v1/masjids/${idText(seedId('none'))}/bundle?v=1`)).status).toBe(404);
    expect((await request(app()).get('/api/v1/masjids/x/bundle?v=1')).status).toBe(404);
    expect((await request(app()).get(`/api/v1/masjids/${BETA}/bundle?v=abc`)).status).toBe(400);
  });

  it('bundle: a suspended masjid answers status "suspended" to its followers', async () => {
    await t()
      .db.collection<Raw>('masjids')
      .updateOne({ _id: seedId('masjid-gamma') }, { $set: { status: 'suspended' } });
    try {
      const v = await versionOf(GAMMA);
      const response = await request(app()).get(`/api/v1/masjids/${GAMMA}/bundle?v=${String(v)}`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'suspended', v });
      const feed = await request(app()).get(`/api/v1/masjids/${GAMMA}/feed?v=${String(v)}`);
      expect(feed.body).toEqual({ items: [], next: null });
    } finally {
      await t()
        .db.collection<Raw>('masjids')
        .updateOne({ _id: seedId('masjid-gamma') }, { $set: { status: 'active' } });
    }
  });

  it('feed: redirects keep the other parameters; pages, type and audience filters', async () => {
    const v = await versionOf(ALPHA);
    const redirect = await request(app()).get(`/api/v1/masjids/${ALPHA}/feed?type=dua_request&aud=sisters&v=1`);
    expect(redirect.status).toBe(302);
    expect(redirect.headers['location']).toBe(
      `/api/v1/masjids/${ALPHA}/feed?v=${String(v)}&aud=sisters&type=dua_request`,
    );
    const page = await request(app()).get(`/api/v1/masjids/${ALPHA}/feed?v=${String(v)}&aud=brothers&limit=4`);
    expect(page.status).toBe(200);
    expect(page.headers['cache-control']).toBe(CACHE.immutable);
    expect(page.headers['cache-tag']).toBe(`m-${ALPHA}`);
    const first = feedPageSchema.parse(page.body);
    expect(first.items).toHaveLength(4);
    const next = await request(app()).get(
      `/api/v1/masjids/${ALPHA}/feed?v=${String(v)}&aud=brothers&cursor=${first.next ?? ''}`,
    );
    const rest = feedPageSchema.parse(next.body);
    expect([...first.items, ...rest.items].map((item) => item.publicId)).not.toContain(seedPublicId('alpha', 6));
    const sisters = feedPageSchema.parse(
      (await request(app()).get(`/api/v1/masjids/${ALPHA}/feed?v=${String(v)}&aud=sisters`)).body,
    );
    expect(sisters.items.map((item) => item.publicId)).toContain(seedPublicId('alpha', 6));
    // Without `aud` only items for everyone.
    const everyone = feedPageSchema.parse(
      (await request(app()).get(`/api/v1/masjids/${ALPHA}/feed?v=${String(v)}`)).body,
    );
    expect(everyone.items.every((item) => item.audience === 'everyone')).toBe(true);
    for (const bad of ['type=nope', 'aud=everyone', 'limit=99x', 'cursor=bad']) {
      const response = await request(app()).get(`/api/v1/masjids/${ALPHA}/feed?v=${String(v)}&${bad}`);
      expect(response.status, bad).toBe(400);
    }
  });
});

describe('items, Ameen, library, templates', () => {
  it('item detail: immutable per version with both cache tags; audience mismatch is ITEM_NOT_FOUND', async () => {
    const v = await versionOf(ALPHA);
    const publicId = seedPublicId('alpha', 1);
    const redirect = await request(app()).get(`/api/v1/items/${publicId}`);
    expect(redirect.status).toBe(302);
    expect(redirect.headers['location']).toBe(`/api/v1/items/${publicId}?v=${String(v)}`);
    const response = await request(app()).get(`/api/v1/items/${publicId}?v=${String(v)}`);
    expect(response.status).toBe(200);
    expect(response.headers['cache-tag']).toBe(`m-${ALPHA}, i-${publicId}`);
    const detail = itemDetailSchema.parse(response.body);
    expect(detail.item.dua?.library?.reference).toBe('DEV-SAMPLE-008');
    expect(detail.masjid.name).toBe('Test Masjid Alpha');
    const sistersOnly = seedPublicId('alpha', 6);
    expect((await request(app()).get(`/api/v1/items/${sistersOnly}?v=${String(v)}&aud=brothers`)).status).toBe(404);
    expect((await request(app()).get(`/api/v1/items/${sistersOnly}?v=${String(v)}&aud=sisters`)).status).toBe(200);
    for (const id of ['unknown00000', 'short', '../../etc']) {
      const missing = await request(app()).get(`/api/v1/items/${encodeURIComponent(id)}`);
      expect(missing.status, id).toBe(404);
      expect(missing.body).toMatchObject({ code: 'ITEM_NOT_FOUND' });
    }
  });

  it('Ameen counts once per device; live counts are a separate, briefly cached endpoint', async () => {
    const dua = seedPublicId('beta', 3);
    const [a, b] = [await register(), await register()];
    const ameen = (auth: string) => request(app()).post(`/api/v1/items/${dua}/ameen`).set('Authorization', auth);
    expect((await ameen(a.auth)).body).toEqual({ count: 1 });
    expect((await ameen(a.auth)).body).toEqual({ count: 1 });
    expect((await ameen(b.auth)).body).toEqual({ count: 2 });
    const counts = await request(app()).get(`/api/v1/ameens?items=${dua},${seedPublicId('beta', 0)}`);
    expect(counts.status).toBe(200);
    expect(counts.headers['cache-control']).toBe(CACHE.ameens);
    expect(counts.body).toEqual({ counts: { [dua]: 2 } });
    expect((await request(app()).post(`/api/v1/items/${dua}/ameen`)).status).toBe(401);
    const notDua = await request(app())
      .post(`/api/v1/items/${seedPublicId('beta', 0)}/ameen`)
      .set('Authorization', a.auth);
    expect(notDua.body).toMatchObject({ code: 'ITEM_NOT_FOUND' });
    expect((await request(app()).post('/api/v1/items/x/ameen').set('Authorization', a.auth)).status).toBe(404);
    expect((await request(app()).get('/api/v1/ameens?items=bad')).status).toBe(400);
    expect((await request(app()).get('/api/v1/ameens')).body).toEqual({ counts: {} });
  });

  it('rate-limits Ameen per device', async () => {
    const limited = buildApp({ ameen: { points: 1, durationSec: 3600 } });
    const device = await register();
    const dua = seedPublicId('gamma', 1);
    expect((await request(limited).post(`/api/v1/items/${dua}/ameen`).set('Authorization', device.auth)).status).toBe(
      200,
    );
    expect((await request(limited).post(`/api/v1/items/${dua}/ameen`).set('Authorization', device.auth)).status).toBe(
      429,
    );
  });

  it('library entries (1 day) and templates (1 hour)', async () => {
    const entry = await request(app()).get(`/api/v1/library/${idText(seedId('library-0'))}`);
    expect(entry.status).toBe(200);
    expect(entry.headers['cache-control']).toBe(CACHE.library);
    expect(entry.body).toMatchObject({ entry: { kind: 'hadith', reference: 'DEV-SAMPLE-001' } });
    expect((await request(app()).get(`/api/v1/library/${idText(seedId('none'))}`)).status).toBe(404);
    expect((await request(app()).get('/api/v1/library/x')).status).toBe(404);
    const templates = await request(app()).get('/api/v1/templates');
    expect(templates.headers['cache-control']).toBe(CACHE.templates);
    expect((templates.body as { templates: unknown[] }).templates).toHaveLength(8);
  });
});

describe('dev / staging seed job', () => {
  it('never runs in production; staging rewrites it only when missing or older than a day', async () => {
    if (!asSystem) throw new Error('no system handle');
    const handle = asSystem.handle;
    await expect(runDevSeed(handle, 'production', NOW)).rejects.toThrow(/never runs in production/);
    await expect(ensureDevSeed(handle, 'production', NOW)).rejects.toThrow(/never runs in production/);
    expect(await ensureDevSeed(handle, 'staging', new Date(NOW.getTime() + 60_000))).toBe('fresh');
    const later = new Date(NOW.getTime() + SEED_REFRESH_MS + 1);
    const before = await versionOf(ALPHA);
    expect(await ensureDevSeed(handle, 'staging', later)).toBe('written');
    expect(await versionOf(ALPHA)).toBe(before + 1);
    await t().db.collection<Raw>('masjids').deleteOne({ follow_code: SEED_FOLLOW_CODES.alpha });
    expect(await ensureDevSeed(handle, 'staging', later)).toBe('written');
    expect(await t().db.collection<Raw>('masjids').countDocuments({ follow_code: SEED_FOLLOW_CODES.alpha })).toBe(1);
  });
});

describe('link previews for /m/:code and /p/:publicId (Caddy og.html includes these fragments)', () => {
  const tags = async (path: string) => {
    const response = await request(app()).get(`/api/v1/og/${path}`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.headers['cache-control']).toBe('public, s-maxage=300');
    return response.text;
  };

  it('a follow link names the masjid; unknown codes get the generic tags', async () => {
    const html = await tags('m/testa001');
    expect(html).toContain('<meta property="og:title" content="Test Masjid Alpha · Masjid Connect">');
    expect(html).toContain('Banjara Hills, Hyderabad');
    expect(await tags('m/ZZZZZZZZ')).toContain('<meta property="og:title" content="Masjid Connect">');
    expect(await tags('m/x')).toContain('<meta property="og:title" content="Masjid Connect">');
  });

  it('a shared post gets a neutral title: no message text, names or religious content', async () => {
    const dua = await tags(`p/${seedPublicId('alpha', 1)}`);
    expect(dua).toContain('content="Request for Dua"');
    expect(dua).not.toContain('Test Person A');
    expect(await tags(`p/${seedPublicId('alpha', 0)}`)).toContain('content="No water supply"');
    expect(await tags(`p/${seedPublicId('alpha', 2)}`)).toContain('content="Hadith of the day"');
    expect(await tags(`p/${seedPublicId('alpha', 5)}`)).toContain('content="Ayah of the day"');
    expect(await tags(`p/${seedPublicId('alpha', 3)}`)).toContain('content="Children’s weekend class"');
    // Sisters-only posts and unknown ids: generic.
    expect(await tags(`p/${seedPublicId('alpha', 6)}`)).toContain(
      '<meta property="og:title" content="Masjid Connect">',
    );
    expect(await tags('p/unknown00000')).toContain('<meta property="og:title" content="Masjid Connect">');
    expect(await tags('p/x')).toContain('<meta property="og:title" content="Masjid Connect">');
  });
});
