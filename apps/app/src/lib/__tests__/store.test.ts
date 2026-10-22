import { describe, expect, it } from 'vitest';

import {
  createDeviceStore,
  initialDeviceState,
  type KeyValueBackend,
  MAX_FOLLOWS,
  memoryBackend,
  migrateDeviceState,
} from '../device/store.ts';

// T2.3 acceptance: corrupt IndexedDB data → the app resets gracefully (04 §11: validated on read, never trusted).

const ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

describe('migrateDeviceState', () => {
  it('first launch: a fresh state in the fallback locale', () => {
    expect(migrateDeviceState(undefined, 'te')).toEqual({ state: initialDeviceState('te'), reset: false });
  });

  it('keeps a valid current document', () => {
    const state = { ...initialDeviceState('ur'), audiencePref: 'sisters' as const, privacyVersion: 'draft-1' };
    expect(migrateDeviceState(state, 'en')).toEqual({ state, reset: false });
  });

  it('resets corrupt, tampered or unknown-version data, keeping only a valid locale', () => {
    const corrupt = [
      'garbage',
      42,
      null,
      { version: 99, locale: 'hi' },
      { ...initialDeviceState('hi'), follows: 'nope' },
      { ...initialDeviceState('hi'), credentials: { deviceId: 'x', secret: 'y' } },
      { ...initialDeviceState('hi'), follows: Array.from({ length: 41 }, () => ({})) },
    ];
    for (const raw of corrupt) {
      const { state, reset } = migrateDeviceState(raw, 'en');
      expect(reset).toBe(true);
      expect(state.follows).toEqual([]);
      expect(state.credentials).toBeUndefined();
    }
    expect(migrateDeviceState({ version: 99, locale: 'hi' }, 'en').state.locale).toBe('hi');
    expect(migrateDeviceState({ version: 99, locale: 'xx' }, 'te').state.locale).toBe('te');
  });
});

describe('createDeviceStore', () => {
  it('loads, resets and rewrites corrupt data, then persists updates', async () => {
    const backend = memoryBackend({ device: { version: 1, locale: 'ur', follows: [{ broken: true }] } });
    const store = createDeviceStore(backend, 'en');
    const { state, reset } = await store.load();
    expect(reset).toBe(true);
    expect(state.locale).toBe('ur');
    expect(await backend.get('device')).toEqual(state);
    await store.update((current) => ({ ...current, audiencePref: 'brothers' }));
    expect(await backend.get('device')).toMatchObject({ audiencePref: 'brothers' });
    expect(store.persistent()).toBe(true);
  });

  it('serializes concurrent updates (none is lost) and notifies subscribers', async () => {
    const store = createDeviceStore(memoryBackend(), 'en');
    await store.load();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        store.update((current) => ({
          ...current,
          saved: [
            ...current.saved,
            { publicId: `item${String(index).padStart(8, '0')}`, savedAt: '2026-10-22T00:00:00.000Z' },
          ],
        })),
      ),
    );
    expect(store.current().saved).toHaveLength(10);
    expect(calls).toBe(10);
    unsubscribe();
  });

  it('refuses an update that breaks the schema (the state stays as it was)', async () => {
    const store = createDeviceStore(memoryBackend(), 'en');
    await store.load();
    await expect(
      store.update((current) => ({
        ...current,
        follows: Array.from({ length: MAX_FOLLOWS * 2 + 1 }, () => ({
          masjidId: ID,
          followedAt: '2026-10-22T00:00:00.000Z',
          muted: false,
          sync: 'synced' as const,
        })),
      })),
    ).rejects.toThrow();
    expect(store.current().follows).toEqual([]);
  });

  it('keeps working in memory when IndexedDB fails (private mode)', async () => {
    const broken: KeyValueBackend = {
      get: () => Promise.reject(new Error('blocked')),
      set: () => Promise.reject(new Error('quota')),
      del: () => Promise.reject(new Error('blocked')),
    };
    const store = createDeviceStore(broken, 'hi');
    expect((await store.load()).state.locale).toBe('hi');
    expect(store.persistent()).toBe(false);
    await store.update((current) => ({ ...current, audiencePref: 'sisters' }));
    expect(store.current().audiencePref).toBe('sisters');
    expect((await store.clear()).audiencePref).toBeUndefined();
  });

  it('clear all data keeps only the locale', async () => {
    const backend = memoryBackend();
    const store = createDeviceStore(backend, 'en');
    await store.load();
    await store.update((current) => ({ ...current, locale: 'te', privacyVersion: 'draft-1' }));
    const cleared = await store.clear();
    expect(cleared).toEqual(initialDeviceState('te'));
    expect(await backend.get('device')).toBeUndefined();
  });
});
