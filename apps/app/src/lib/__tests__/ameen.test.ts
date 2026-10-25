import { useMockNetwork as mockNetwork } from '@mc/shared/testing/msw';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApiClient } from '../api/client.ts';
import { ameenDisplayCount, flushAmeens, sayAmeenLocally } from '../device/ameen.ts';
import { createDeviceStore, type DeviceStore, memoryBackend } from '../device/store.ts';
import type { SyncDeps } from '../device/sync.ts';

// T2.11 Ameen (07 A9, 08 §5.6): once per device, optimistic, queued while offline or unregistered, retried quietly.

const BASE = 'https://app.test/api/v1';
const DEVICE = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const DUA_A = 'duaAAAAAAAAA';
const DUA_B = 'duaBBBBBBBBB';
const GONE = 'duaGONEGONE0';
const problem = (status: number, code: string) =>
  HttpResponse.json(
    { type: 'about:blank', title: code, status, code },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );

const server = mockNetwork();
let store: DeviceStore;
let deps: SyncDeps;
let counts: Map<string, number>;
let posts: string[];
let mode: 'ok' | 'offline' | 'busy' | 'limited';

beforeEach(async () => {
  store = createDeviceStore(memoryBackend(), 'en');
  await store.load();
  counts = new Map([
    [DUA_A, 10],
    [DUA_B, 0],
  ]);
  posts = [];
  mode = 'ok';
  const api = createApiClient({
    base: BASE,
    credentials: () => store.current().credentials,
    backoff: () => Promise.resolve(),
  });
  deps = { store, api, turnstileToken: () => Promise.resolve('token'), platform: 'android' };
  server.use(
    http.post(`${BASE}/items/:id/ameen`, ({ params }) => {
      const id = String(params['id']);
      posts.push(id);
      if (mode === 'offline') return HttpResponse.error();
      if (mode === 'busy') return problem(503, 'SERVICE_UNAVAILABLE');
      if (mode === 'limited') return problem(429, 'RATE_LIMITED');
      const count = counts.get(id);
      if (count === undefined) return problem(404, 'ITEM_NOT_FOUND');
      counts.set(id, count + 1);
      return HttpResponse.json({ count: count + 1 });
    }),
  );
});

const register = () =>
  store.update((state) => ({ ...state, credentials: { deviceId: DEVICE, secret: 'S'.repeat(43) } }));

describe('Ameen queue', () => {
  it('records once per device: the second tap is refused locally', async () => {
    expect(await sayAmeenLocally(store, DUA_A)).toBe(true);
    expect(await sayAmeenLocally(store, DUA_A)).toBe(false);
    expect(store.current().ameens).toEqual([DUA_A]);
    expect(store.current().pendingAmeens).toEqual([DUA_A]);
  });

  it('stays queued until the device is registered, then sends each once and reports the counts', async () => {
    await sayAmeenLocally(store, DUA_A);
    await sayAmeenLocally(store, DUA_B);
    expect(await flushAmeens(deps)).toEqual({ confirmed: new Map(), pending: 2 });
    expect(posts).toEqual([]);
    await register();
    expect(await flushAmeens(deps)).toEqual({
      confirmed: new Map([
        [DUA_A, 11],
        [DUA_B, 1],
      ]),
      pending: 0,
    });
    expect(store.current().pendingAmeens).toEqual([]);
    expect(store.current().ameens).toEqual([DUA_A, DUA_B]);
    expect(await flushAmeens(deps)).toEqual({ confirmed: new Map(), pending: 0 });
    expect(posts).toEqual([DUA_A, DUA_B]);
  });

  it('offline, server trouble or rate limit: stops quietly and keeps the queue (08 §5.6 "retries later")', async () => {
    await register();
    await sayAmeenLocally(store, DUA_A);
    for (const failure of ['offline', 'busy', 'limited'] as const) {
      mode = failure;
      expect((await flushAmeens(deps)).pending).toBe(1);
    }
    mode = 'ok';
    expect((await flushAmeens(deps)).confirmed.get(DUA_A)).toBe(11);
  });

  it('a removed request is dropped from the queue (the button state stays)', async () => {
    await register();
    await sayAmeenLocally(store, GONE);
    await sayAmeenLocally(store, DUA_B);
    const result = await flushAmeens(deps);
    expect(result).toEqual({ confirmed: new Map([[DUA_B, 1]]), pending: 0 });
    expect(store.current().ameens).toContain(GONE);
  });

  it('keeps the newest 2000 Ameens on the phone', async () => {
    const ids = Array.from({ length: 2000 }, (_, index) => `old${String(index).padStart(9, '0')}`);
    await store.update((state) => ({ ...state, ameens: ids }));
    await sayAmeenLocally(store, DUA_A);
    const { ameens } = store.current();
    expect(ameens).toHaveLength(2000);
    expect(ameens.at(-1)).toBe(DUA_A);
    expect(ameens).not.toContain(ids[0]);
  });
});

describe('ameenDisplayCount', () => {
  it('shows the larger of the server and confirmed counts, plus this device while its Ameen is unsent', () => {
    expect(ameenDisplayCount(undefined, undefined, false)).toBeUndefined();
    expect(ameenDisplayCount(10, undefined, false)).toBe(10);
    expect(ameenDisplayCount(10, undefined, true)).toBe(11);
    // A CDN answer up to 30 s old must not roll the count back after our own Ameen was confirmed.
    expect(ameenDisplayCount(10, 12, false)).toBe(12);
    expect(ameenDisplayCount(13, 12, false)).toBe(13);
    expect(ameenDisplayCount(undefined, 4, false)).toBe(4);
    // Nothing known from the server (offline from the start): no number rather than a wrong one.
    expect(ameenDisplayCount(undefined, undefined, true)).toBeUndefined();
  });
});
