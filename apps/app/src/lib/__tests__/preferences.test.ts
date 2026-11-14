import { useMockNetwork as mockNetwork } from '@mc/shared/testing/msw';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApiClient } from '../api/client.ts';
import {
  acceptPrivacyNotice,
  clearAllData,
  finishPendingDeletion,
  syncPreferences,
  updatePreferences,
  wipeCachedContent,
} from '../device/preferences.ts';
import { PRIVACY_REMINDER_MS, privacyRecheck } from '../device/privacy-notice.ts';
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
    expect(patches).toEqual([{ locale: 'en', audiencePref: 'sisters', privacyVersion: 'draft-1' }]);
    expect(await updatePreferences(deps, { locale: 'ur' })).toBe('saved');
    expect(store.current().locale).toBe('ur');
    expect(patches.at(-1)).toEqual({ locale: 'ur', audiencePref: 'sisters', privacyVersion: 'draft-1' });
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
    expect(patches).toEqual([{ locale: 'en', audiencePref: 'sisters', privacyVersion: 'draft-1' }]);
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

  it('also empties the cached copies of followed masjids — worker caches and persisted queries (M1)', async () => {
    const deleted: string[] = [];
    const queryCache = memoryBackend();
    await queryCache.setMany([
      ['q:["bundle","m1",3]', {}],
      ['q:["feed","m1",3,"brothers"]', {}],
    ]);
    const cachesLike = {
      delete: (name: string) => {
        deleted.push(name);
        return Promise.resolve(true);
      },
    };
    mode = 'offline';
    expect(await clearAllData(deps, { caches: cachesLike, queryCache })).toBe('queued');
    expect(deleted.sort()).toEqual(['mc-api-v1', 'mc-audio-v1', 'mc-images-v1', 'mc-versions-v1']);
    expect(await queryCache.entries()).toEqual([]);
    // A cache that cannot be emptied does not stop the rest.
    await wipeCachedContent({ caches: { delete: () => Promise.reject(new Error('blocked')) }, queryCache });
  });

  it('ends the browser push subscription too — online and while the deletion waits offline (review L9, DECISIONS #142)', async () => {
    let unsubscribed = 0;
    const unsubscribe = () => {
      unsubscribed += 1;
      return Promise.resolve();
    };
    mode = 'offline';
    expect(await clearAllData(deps, undefined, unsubscribe)).toBe('queued'); // the server record is deleted later
    expect(unsubscribed).toBe(1);
    mode = 'ok';
    expect(await clearAllData(deps, undefined, unsubscribe)).toBe('deleted');
    expect(unsubscribed).toBe(2);
  });

  it('ends the push subscription even when wiping the phone fails (re-review L-R4, DECISIONS #144)', async () => {
    let unsubscribed = 0;
    const unsubscribe = () => {
      unsubscribed += 1;
      return Promise.resolve();
    };
    const broken: SyncDeps = { ...deps, store: { ...store, clear: () => Promise.reject(new Error('quota')) } };
    await expect(clearAllData(broken, undefined, unsubscribe)).rejects.toThrow('quota');
    expect(unsubscribed).toBe(1);
  });

  it('the default unsubscribe is harmless where the browser has no service worker', async () => {
    expect(await clearAllData(deps)).toBe('deleted'); // jsdom: no `navigator.serviceWorker` — nothing to end
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

describe('privacy notice re-acceptance (T8.6)', () => {
  const at = (iso: string) => new Date(iso);
  it('asks again when the server version differs, and a year after acceptance; never before onboarding or offline', () => {
    const state = { onboardedAt: '2026-10-01T00:00:00.000Z', privacyVersion: 'draft-1' };
    const soon = at('2026-11-13T00:00:00.000Z');
    expect(privacyRecheck(state, 'draft-1', soon)).toBeNull();
    expect(privacyRecheck(state, 'v2', soon)).toBe('changed');
    expect(privacyRecheck(state, undefined, soon)).toBeNull();
    expect(privacyRecheck({ privacyVersion: 'draft-1' }, 'v2', soon)).toBeNull();
    // No acceptance time (phones onboarded before T8.6): the onboarding time stands in.
    const yearOn = new Date(Date.parse(state.onboardedAt) + PRIVACY_REMINDER_MS);
    expect(privacyRecheck(state, 'draft-1', yearOn)).toBe('yearly');
    const accepted = { ...state, privacyAcceptedAt: '2026-11-01T00:00:00.000Z' };
    expect(privacyRecheck(accepted, 'draft-1', yearOn)).toBeNull();
    expect(
      privacyRecheck(accepted, 'draft-1', new Date(Date.parse(accepted.privacyAcceptedAt) + PRIVACY_REMINDER_MS)),
    ).toBe('yearly');
  });

  it('accepting stores the version and time on the phone and tells the server; offline it is queued', async () => {
    const now = at('2026-11-13T06:00:00.000Z');
    expect(await acceptPrivacyNotice(deps, 'v2', now)).toBe('saved');
    expect(store.current()).toMatchObject({ privacyVersion: 'v2', privacyAcceptedAt: now.toISOString() });
    expect(patches.at(-1)).toEqual({ locale: 'en', audiencePref: 'brothers', privacyVersion: 'v2' });
    expect(privacyRecheck(store.current(), 'v2', now)).toBeNull();
    mode = 'offline';
    expect(await acceptPrivacyNotice(deps, 'v3', now)).toBe('queued');
    expect(store.current()).toMatchObject({ privacyVersion: 'v3', prefsPending: true });
    mode = 'ok';
    expect(await syncPreferences(deps)).toBe('saved');
    expect(patches.at(-1)).toMatchObject({ privacyVersion: 'v3' });
  });
});
