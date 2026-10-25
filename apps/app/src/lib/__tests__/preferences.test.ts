import { useMockNetwork as mockNetwork } from '@mc/shared/testing/msw';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApiClient } from '../api/client.ts';
import { clearAllData, finishPendingDeletion, syncPreferences, updatePreferences } from '../device/preferences.ts';
import { createDeviceStore, type DeviceStore, memoryBackend } from '../device/store.ts';
import type { SyncDeps } from '../device/sync.ts';

// T2.12 Settings: language / brother-sister reach the server device record (queued while offline) — feeds refilter by
// `aud` in their query keys; "Clear all data" (05 §4, journey 12) deletes the server record and everything on the
// phone, and is queued when offline.

const BASE = 'https://app.test/api/v1';
const DEVICE = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const SECRET = 'S'.repeat(43);
const A = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const problem = (status: number, code: string) =>
  HttpResponse.json(
    { type: 'about:blank', title: code, status, code },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );

const server = mockNetwork();
let store: DeviceStore;
let deps: SyncDeps;
let patches: unknown[];
let deletes: string[];
let mode: 'ok' | 'offline' | 'busy' | 'gone';

beforeEach(async () => {
  store = createDeviceStore(memoryBackend(), 'en');
  await store.load();
  patches = [];
  deletes = [];
  mode = 'ok';
  const api = createApiClient({
    base: BASE,
    credentials: () => store.current().credentials,
    backoff: () => Promise.resolve(),
  });
  deps = { store, api, turnstileToken: () => Promise.resolve('token'), platform: 'android' };
  const answer = () => {
    if (mode === 'offline') return HttpResponse.error();
    if (mode === 'busy') return problem(503, 'SERVICE_UNAVAILABLE');
    if (mode === 'gone') return problem(401, 'DEVICE_AUTH_REQUIRED');
    return null;
  };
  server.use(
    http.patch(`${BASE}/devices/me`, async ({ request }) => {
      const failure = answer();
      if (failure) return failure;
      patches.push(await request.json());
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete(`${BASE}/devices/me`, ({ request }) => {
      const failure = answer();
      if (failure) return failure;
      deletes.push(request.headers.get('Authorization') ?? '');
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${BASE}/devices`, () => HttpResponse.json({ deviceId: DEVICE, secret: SECRET }, { status: 201 })),
    http.put(`${BASE}/devices/me/follows/:id`, () => HttpResponse.json({ status: 'followed' })),
  );
  await store.update((state) => ({
    ...state,
    credentials: { deviceId: DEVICE, secret: SECRET },
    audiencePref: 'brothers',
    privacyVersion: 'draft-1',
    onboardedAt: '2026-10-01T00:00:00.000Z',
    follows: [{ masjidId: A, followedAt: '2026-10-01T00:00:00.000Z', muted: false, sync: 'synced' }],
    saved: [{ publicId: 'savedAAAAAAA', savedAt: '2026-10-02T00:00:00.000Z' }],
    ameens: ['duaAAAAAAAAA'],
    settings: { vibration: false, arabicScale: 1.2, transliteration: false },
  }));
});

describe('preferences', () => {
  it('changes the phone at once and the server device record (language and brother/sister together)', async () => {
    expect(await updatePreferences(deps, { audiencePref: 'sisters' })).toBe('saved');
    expect(store.current().audiencePref).toBe('sisters');
    expect(patches).toEqual([{ locale: 'en', audiencePref: 'sisters' }]);
    expect(await updatePreferences(deps, { locale: 'ur' })).toBe('saved');
    expect(store.current().locale).toBe('ur');
    expect(patches.at(-1)).toEqual({ locale: 'ur', audiencePref: 'sisters' });
    expect(store.current().prefsPending).toBeUndefined();
  });

  it('offline or server trouble: queued, sent on the next sync', async () => {
    mode = 'offline';
    expect(await updatePreferences(deps, { audiencePref: 'sisters' })).toBe('queued');
    expect(store.current()).toMatchObject({ audiencePref: 'sisters', prefsPending: true });
    mode = 'busy';
    expect(await syncPreferences(deps)).toBe('queued');
    mode = 'ok';
    expect(await syncPreferences(deps)).toBe('saved');
    expect(patches).toEqual([{ locale: 'en', audiencePref: 'sisters' }]);
    expect(store.current().prefsPending).toBeUndefined();
    expect(await syncPreferences(deps)).toBe('none');
  });

  it('not registered yet: kept on the phone; registration sends it anyway', async () => {
    await store.update((state) => {
      const { credentials: _gone, ...rest } = state;
      return rest;
    });
    expect(await updatePreferences(deps, { locale: 'te' })).toBe('queued');
    expect(patches).toEqual([]);
    expect(store.current().prefsPending).toBeUndefined();
  });

  it('a device the server forgot registers again (with the new choice)', async () => {
    mode = 'gone';
    expect(await updatePreferences(deps, { audiencePref: 'sisters' })).toBe('queued');
    // Registered again (POST /devices carries the current language and brother/sister choice).
    expect(store.current()).toMatchObject({ credentials: { deviceId: DEVICE }, registrationPending: false });
    expect(store.current().prefsPending).toBeUndefined();
  });
});

describe('clear all data (05 §4, journey 12)', () => {
  it('deletes the server record, then everything on the phone except the language', async () => {
    await updatePreferences(deps, { locale: 'hi' });
    expect(await clearAllData(deps)).toBe('deleted');
    expect(deletes).toEqual([`Device ${DEVICE}.${SECRET}`]);
    const state = store.current();
    expect(state).toMatchObject({ locale: 'hi', follows: [], saved: [], ameens: [], pendingAmeens: [] });
    expect(state.credentials).toBeUndefined();
    expect(state.onboardedAt).toBeUndefined();
    expect(state.audiencePref).toBeUndefined();
    expect(state.pendingDeletion).toBeUndefined();
    expect(state.settings).toEqual({ vibration: true, arabicScale: 1, transliteration: true });
  });

  it('offline: the phone is cleared now; the old record is deleted when the connection returns', async () => {
    mode = 'offline';
    expect(await clearAllData(deps)).toBe('queued');
    expect(store.current().follows).toEqual([]);
    expect(store.current().pendingDeletion).toEqual({ deviceId: DEVICE, secret: SECRET });
    expect(await finishPendingDeletion(deps)).toBe('pending');
    mode = 'ok';
    expect(await finishPendingDeletion(deps)).toBe('deleted');
    expect(deletes).toEqual([`Device ${DEVICE}.${SECRET}`]);
    expect(store.current().pendingDeletion).toBeUndefined();
    expect(await finishPendingDeletion(deps)).toBe('none');
  });

  it('a record the server already removed counts as deleted', async () => {
    mode = 'gone';
    expect(await clearAllData(deps)).toBe('deleted');
    expect(store.current().pendingDeletion).toBeUndefined();
  });

  it('never registered: nothing to delete on the server', async () => {
    await store.update((state) => {
      const { credentials: _gone, ...rest } = state;
      return rest;
    });
    expect(await clearAllData(deps)).toBe('deleted');
    expect(deletes).toEqual([]);
  });
});
