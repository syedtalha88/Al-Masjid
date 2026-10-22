import { NetworkError, ProblemError } from '@mc/shared/http';
import { useMockNetwork as mockNetwork } from '@mc/shared/testing/msw';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { createApiClient, isAuthLost } from '../api/client.ts';

// 03 §7: typed client — device header injection, GET retried twice with jitter (never on 4xx, never non-GET),
// server clock offset from `Date`, problem codes typed.

const BASE = 'https://app.test/api/v1';
const ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const OTHER = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const credentials = { deviceId: ID, secret: 'A'.repeat(43) };
const problem = (status: number, code: string) =>
  HttpResponse.json(
    { type: 'about:blank', title: code, status, code },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );

const server = mockNetwork();
const noWait = () => Promise.resolve();

describe('createApiClient', () => {
  it('sends the device header only on device calls; versions ids are sorted for the CDN', async () => {
    const seen: (string | null)[] = [];
    let versionsUrl = '';
    server.use(
      http.get(`${BASE}/devices/me/follows`, ({ request }) => {
        seen.push(request.headers.get('authorization'));
        return HttpResponse.json({ follows: [] });
      }),
      http.get(`${BASE}/masjids/versions`, ({ request }) => {
        seen.push(request.headers.get('authorization'));
        versionsUrl = request.url;
        return HttpResponse.json({});
      }),
    );
    const api = createApiClient({ base: BASE, credentials: () => credentials, backoff: noWait });
    await api.follows();
    await api.versions([ID, OTHER]);
    expect(seen).toEqual([`Device ${ID}.${'A'.repeat(43)}`, null]);
    expect(new URL(versionsUrl).searchParams.get('ids')).toBe(`${OTHER},${ID}`);
  });

  it('refuses a device call before registration without a request', async () => {
    const api = createApiClient({ base: BASE, credentials: () => undefined });
    const error = await api.follows().catch((caught: unknown) => caught);
    expect(isAuthLost(error)).toBe(true);
  });

  it('retries a GET twice on network errors and 5xx, then succeeds or gives up', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/config`, () => {
        calls += 1;
        return calls < 3 ? problem(503, 'SERVICE_UNAVAILABLE') : HttpResponse.json(CONFIG);
      }),
    );
    const api = createApiClient({ base: BASE, credentials: () => undefined, backoff: noWait });
    expect((await api.config()).globalHijriOffset).toBe(0);
    expect(calls).toBe(3);

    calls = 0;
    server.use(
      http.get(`${BASE}/templates`, () => {
        calls += 1;
        return HttpResponse.error();
      }),
    );
    await expect(api.templates()).rejects.toBeInstanceOf(NetworkError);
    expect(calls).toBe(3);
  });

  it('never retries a 4xx, nor a non-GET', async () => {
    let gets = 0;
    let posts = 0;
    server.use(
      http.get(`${BASE}/masjids/resolve/:code`, () => {
        gets += 1;
        return problem(404, 'MASJID_NOT_FOUND');
      }),
      http.post(`${BASE}/items/:id/ameen`, () => {
        posts += 1;
        return problem(503, 'SERVICE_UNAVAILABLE');
      }),
    );
    const api = createApiClient({ base: BASE, credentials: () => credentials, backoff: noWait });
    const error = await api.resolve('ZZZZZZZZ').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProblemError);
    expect(gets).toBe(1);
    await expect(api.ameen('seedA0000001')).rejects.toBeInstanceOf(ProblemError);
    expect(posts).toBe(1);
  });

  it('reports a lost device (401) and the server clock offset', async () => {
    let lost = 0;
    const offsets: (number | null)[] = [];
    server.use(
      http.get(`${BASE}/devices/me`, () => problem(401, 'DEVICE_AUTH_REQUIRED')),
      http.get(`${BASE}/config`, () =>
        HttpResponse.json(CONFIG, { headers: { Date: new Date(Date.now() + 10 * 60_000).toUTCString() } }),
      ),
    );
    const api = createApiClient({
      base: BASE,
      credentials: () => credentials,
      onAuthLost: () => {
        lost += 1;
      },
      onServerTime: (offset) => offsets.push(offset),
      backoff: noWait,
    });
    await expect(api.me()).rejects.toBeInstanceOf(ProblemError);
    expect(lost).toBe(1);
    await api.config();
    const measured = offsets.at(-1);
    expect(measured).toBeGreaterThan(9 * 60_000);
    expect(measured).toBeLessThan(11 * 60_000);
  });

  it('covers every endpoint shape (follow, mute, unfollow, register, bundle, feed, item, ameen, library)', async () => {
    server.use(
      http.post(`${BASE}/devices`, () => HttpResponse.json({ deviceId: ID, secret: 'B'.repeat(43) }, { status: 201 })),
      http.patch(`${BASE}/devices/me`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/devices/me`, () => new HttpResponse(null, { status: 204 })),
      http.put(`${BASE}/devices/me/follows/:id`, () => HttpResponse.json({ status: 'followed' })),
      http.patch(`${BASE}/devices/me/follows/:id`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/devices/me/follows/:id`, () => new HttpResponse(null, { status: 204 })),
      http.get(`${BASE}/masjids/:id/bundle`, () => HttpResponse.json({ status: 'suspended', v: 3 })),
      http.get(`${BASE}/masjids/:id/feed`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('aud')).toBe('sisters');
        expect(url.searchParams.get('type')).toBe('dua_request');
        return HttpResponse.json({ items: [], next: null });
      }),
      http.get(`${BASE}/items/:id`, () => problem(404, 'ITEM_NOT_FOUND')),
      http.post(`${BASE}/items/:id/ameen`, () => HttpResponse.json({ count: 7 })),
      http.get(`${BASE}/ameens`, () => HttpResponse.json({ counts: { seedA0000001: 7 } })),
      http.get(`${BASE}/library/:id`, () => problem(404, 'NOT_FOUND')),
      http.get(`${BASE}/masjids/resolve/:code`, () => problem(404, 'MASJID_NOT_FOUND')),
    );
    const api = createApiClient({ base: BASE, credentials: () => credentials, backoff: noWait });
    expect(
      await api.register({
        locale: 'en',
        audiencePref: 'brothers',
        platform: 'android',
        privacyVersion: 'd',
        turnstileToken: 't',
      }),
    ).toMatchObject({ deviceId: ID });
    await expect(api.updateMe({ locale: 'hi' })).resolves.toBeUndefined();
    await expect(api.deleteMe()).resolves.toBeUndefined();
    expect(await api.follow(ID)).toBe('followed');
    await expect(api.mute(ID, true)).resolves.toBeUndefined();
    await expect(api.unfollow(ID)).resolves.toBeUndefined();
    expect(await api.bundle(ID, 3)).toEqual({ status: 'suspended', v: 3 });
    expect(await api.feed(ID, { v: 3, aud: 'sisters', type: 'dua_request' })).toEqual({ items: [], next: null });
    await expect(api.item('seedA0000001', { aud: 'brothers' })).rejects.toBeInstanceOf(ProblemError);
    expect(await api.ameen('seedA0000001')).toBe(7);
    expect(await api.ameenCounts(['seedA0000001'])).toEqual({ counts: { seedA0000001: 7 } });
    await expect(api.library(ID)).rejects.toBeInstanceOf(ProblemError);
  });
});

const CONFIG = {
  globalHijriOffset: 0,
  legalVersions: { privacy: 'draft-1', terms: 'draft-1' },
  minClientVersion: '0.0.0',
  grievanceOfficer: { name: 'NOT SET', email: 'NOT SET', address: 'NOT SET', city: 'NOT SET' },
};
