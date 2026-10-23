import { useMockNetwork as mockNetwork } from '@mc/shared/testing/msw';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApiClient } from '../api/client.ts';
import { createDeviceStore, type DeviceStore, memoryBackend } from '../device/store.ts';
import {
  ensureRegistered,
  followLocally,
  reconcileFollows,
  type SyncDeps,
  syncFollows,
  unfollowLocally,
  visibleFollows,
} from '../device/sync.ts';

// T2.3: registration retry queue (07 A1: offline at "Continue" → the app continues and registers later) and follow
// reconciliation with the server copy.

const BASE = 'https://app.test/api/v1';
const DEVICE = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const A = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const B = '1b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e';
const C = '2c3d4e5f-6a7b-4c8d-ae9f-0a1b2c3d4e5f';
const NOW = new Date('2026-10-22T06:30:00Z');
const problem = (status: number, code: string) =>
  HttpResponse.json(
    { type: 'about:blank', title: code, status, code },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );

const server = mockNetwork();
let store: DeviceStore;
let deps: SyncDeps;
let serverFollows: Set<string>;
let registrations: number;

beforeEach(async () => {
  store = createDeviceStore(memoryBackend(), 'en');
  await store.load();
  serverFollows = new Set();
  registrations = 0;
  const api = createApiClient({
    base: BASE,
    credentials: () => store.current().credentials,
    backoff: () => Promise.resolve(),
  });
  deps = { store, api, turnstileToken: () => Promise.resolve('token'), platform: 'android' };
  server.use(
    http.post(`${BASE}/devices`, () => {
      registrations += 1;
      return HttpResponse.json({ deviceId: DEVICE, secret: 'S'.repeat(43) }, { status: 201 });
    }),
    http.put(`${BASE}/devices/me/follows/:id`, ({ params }) => {
      serverFollows.add(String(params['id']));
      return HttpResponse.json({ status: 'followed' });
    }),
    http.delete(`${BASE}/devices/me/follows/:id`, ({ params }) => {
      serverFollows.delete(String(params['id']));
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(`${BASE}/devices/me/follows`, () =>
      HttpResponse.json({
        follows: [...serverFollows].map((masjidId) => ({ masjidId, muted: false, followedAt: NOW.toISOString() })),
      }),
    ),
  );
});

const onboard = () => store.update((state) => ({ ...state, audiencePref: 'brothers', privacyVersion: 'draft-1' }));

describe('ensureRegistered', () => {
  it('waits for onboarding (brother/sister + privacy accepted)', async () => {
    expect(await ensureRegistered(deps)).toBe('not-ready');
    expect(registrations).toBe(0);
  });

  it('offline → deferred and pending; later it registers and sends the queued follows', async () => {
    await onboard();
    await followLocally(store, A, NOW);
    server.use(http.post(`${BASE}/devices`, () => HttpResponse.error()));
    expect(await ensureRegistered(deps)).toBe('deferred');
    expect(store.current().registrationPending).toBe(true);
    expect(store.current().credentials).toBeUndefined();
    server.resetHandlers();
    // back online (the default handlers above are restored by re-registering them)
    server.use(
      http.post(`${BASE}/devices`, () =>
        HttpResponse.json({ deviceId: DEVICE, secret: 'S'.repeat(43) }, { status: 201 }),
      ),
      http.put(`${BASE}/devices/me/follows/:id`, ({ params }) => {
        serverFollows.add(String(params['id']));
        return HttpResponse.json({ status: 'followed' });
      }),
    );
    expect(await ensureRegistered(deps)).toBe('registered');
    expect(store.current()).toMatchObject({ registrationPending: false, credentials: { deviceId: DEVICE } });
    expect([...serverFollows]).toEqual([A]);
    expect(store.current().follows[0]?.sync).toBe('synced');
    expect(await ensureRegistered(deps)).toBe('already');
  });

  it('a failed Turnstile check or a busy server is retried later; a broken request is a bug', async () => {
    await onboard();
    server.use(http.post(`${BASE}/devices`, () => problem(403, 'TURNSTILE_FAILED')));
    expect(await ensureRegistered(deps)).toBe('deferred');
    server.use(http.post(`${BASE}/devices`, () => problem(429, 'RATE_LIMITED')));
    expect(await ensureRegistered(deps)).toBe('deferred');
    server.use(http.post(`${BASE}/devices`, () => problem(400, 'VALIDATION_FAILED')));
    await expect(ensureRegistered(deps)).rejects.toThrow();
    // No Turnstile token (offline, widget failed): deferred, nothing sent.
    const failing = { ...deps, turnstileToken: () => Promise.reject(new Error('no token')) };
    expect(await ensureRegistered(failing)).toBe('deferred');
  });
});

describe('local follows', () => {
  it('follow is idempotent and capped at 20; unfollow hides at once', async () => {
    expect(await followLocally(store, A, NOW)).toBe('added');
    expect(await followLocally(store, A, NOW)).toBe('already');
    for (let index = 0; index < 19; index += 1) {
      await followLocally(store, `0a1b2c3d-4e5f-4a6b-8c7d-${String(index).padStart(12, '0')}`, NOW);
    }
    expect(await followLocally(store, B, NOW)).toBe('limit');
    // A never reached the server: unfollowing drops it entirely.
    await unfollowLocally(store, A);
    expect(store.current().follows.some((follow) => follow.masjidId === A)).toBe(false);
  });

  it('a synced follow is unfollowed on the server on the next sync', async () => {
    await onboard();
    await ensureRegistered(deps);
    await followLocally(store, B, NOW);
    await syncFollows(deps);
    expect(serverFollows.has(B)).toBe(true);
    await unfollowLocally(store, B);
    expect(visibleFollows(store.current().follows)).toEqual([]);
    expect(store.current().follows[0]?.sync).toBe('unfollow');
    // Following again before the sync just flips it back.
    expect(await followLocally(store, B, NOW)).toBe('added');
    await unfollowLocally(store, B);
    expect(await syncFollows(deps)).toEqual({ sent: 1, dropped: [] });
    expect(serverFollows.has(B)).toBe(false);
    expect(store.current().follows).toEqual([]);
  });

  it('drops masjids the server refuses, stops quietly offline, skips before registration', async () => {
    expect(await syncFollows(deps)).toEqual({ sent: 0, dropped: [] });
    await onboard();
    await ensureRegistered(deps);
    await followLocally(store, A, NOW);
    await followLocally(store, B, NOW);
    server.use(
      http.put(`${BASE}/devices/me/follows/${A}`, () => problem(404, 'MASJID_NOT_FOUND')),
      http.put(`${BASE}/devices/me/follows/${B}`, () => HttpResponse.error()),
    );
    expect(await syncFollows(deps)).toEqual({ sent: 0, dropped: [A] });
    expect(store.current().follows.map((follow) => [follow.masjidId, follow.sync])).toEqual([[B, 'follow']]);
    server.use(http.put(`${BASE}/devices/me/follows/${B}`, () => problem(500, 'INTERNAL_ERROR')));
    await expect(syncFollows(deps)).rejects.toThrow();
  });
});

describe('reconcileFollows', () => {
  it('re-sends follows the server lost and adopts the server’s extra ones', async () => {
    await onboard();
    await followLocally(store, A, NOW);
    await ensureRegistered(deps);
    serverFollows.delete(A); // the server lost it
    serverFollows.add(C); // another install of this device followed C
    const outcome = await reconcileFollows(deps);
    expect(outcome.sent).toBe(1);
    expect([...serverFollows].sort()).toEqual([A, C].sort());
    expect(store.current().follows.map((follow) => [follow.masjidId, follow.sync])).toEqual([
      [A, 'synced'],
      [C, 'synced'],
    ]);
  });

  it('a forgotten device registers again and re-sends every follow', async () => {
    await onboard();
    await followLocally(store, A, NOW);
    await ensureRegistered(deps);
    expect(registrations).toBe(1);
    server.use(http.get(`${BASE}/devices/me/follows`, () => problem(401, 'DEVICE_AUTH_REQUIRED')));
    serverFollows.clear();
    await reconcileFollows(deps);
    expect(registrations).toBe(2);
    expect([...serverFollows]).toEqual([A]);
  });

  it('offline or unregistered: nothing happens', async () => {
    expect(await reconcileFollows(deps)).toEqual({ sent: 0, dropped: [] });
    await onboard();
    await ensureRegistered(deps);
    server.use(http.get(`${BASE}/devices/me/follows`, () => HttpResponse.error()));
    expect(await reconcileFollows(deps)).toEqual({ sent: 0, dropped: [] });
  });
});
