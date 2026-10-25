// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { NAV_CONFIG } from '../../app/AppNavigator.tsx';
import { requestBackgroundAmeens } from '../device/ameen.ts';
import { launchAction } from '../launch.ts';
import { isServerUnreachable, reportReachability, resetReachability, subscribeReachability } from '../reachability.ts';
import { requestPersistentStorage } from '../storage.ts';
import { AMEEN_SYNC_TAG, queuedAmeens } from '../sw-protocol.ts';

// PHASE_02 T2.13 (01 §5.6): the offline banner's "requests fail" signal, persistent storage after the first follow,
// and Background Sync for Ameens said offline (what the worker reads from the device document).

afterEach(() => {
  resetReachability();
});

describe('reachability', () => {
  it('turns unreachable on a failed request and back on the next answer, notifying only on changes', () => {
    let changes = 0;
    const unsubscribe = subscribeReachability(() => {
      changes += 1;
    });
    reportReachability(true);
    expect(isServerUnreachable()).toBe(false);
    reportReachability(false);
    reportReachability(false);
    expect(isServerUnreachable()).toBe(true);
    reportReachability(true);
    expect(isServerUnreachable()).toBe(false);
    expect(changes).toBe(2);
    unsubscribe();
  });

  it('the browser coming back online clears it (the next request decides again)', () => {
    reportReachability(false);
    window.dispatchEvent(new Event('online'));
    expect(isServerUnreachable()).toBe(false);
  });
});

describe('requestPersistentStorage', () => {
  it('asks only when not yet persistent, and never rejects', async () => {
    let asked = 0;
    const storage = (persisted: boolean, grant: boolean | Error) => ({
      persisted: () => Promise.resolve(persisted),
      persist: () => {
        asked += 1;
        return grant instanceof Error ? Promise.reject(grant) : Promise.resolve(grant);
      },
    });
    expect(await requestPersistentStorage(storage(true, false))).toBe(true);
    expect(asked).toBe(0);
    expect(await requestPersistentStorage(storage(false, true))).toBe(true);
    expect(await requestPersistentStorage(storage(false, false))).toBe(false);
    expect(await requestPersistentStorage(storage(false, new Error('denied')))).toBe(false);
    expect(asked).toBe(3);
  });

  it('is a no-op without the Storage API (older Safari)', async () => {
    expect(await requestPersistentStorage(undefined)).toBe(false);
    const noPersist: Partial<StorageManager> = {};
    expect(await requestPersistentStorage(noPersist as Pick<StorageManager, 'persist' | 'persisted'>)).toBe(false);
  });
});

describe('queuedAmeens (the worker reads the device document — 04 §11: checked, never trusted)', () => {
  const credentials = { deviceId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', secret: 'A'.repeat(43) };

  it('returns the device header and the queued public ids', () => {
    expect(queuedAmeens({ credentials, pendingAmeens: ['seedA0000001', 'seedB0000002'] })).toEqual({
      authorization: `Device ${credentials.deviceId}.${'A'.repeat(43)}`,
      publicIds: ['seedA0000001', 'seedB0000002'],
    });
  });

  it('drops malformed ids and refuses unregistered, empty or malformed documents', () => {
    expect(queuedAmeens({ credentials, pendingAmeens: ['../../x', 42, 'seedA0000001'] })?.publicIds).toEqual([
      'seedA0000001',
    ]);
    expect(queuedAmeens({ pendingAmeens: ['seedA0000001'] })).toBeNull();
    expect(queuedAmeens({ credentials, pendingAmeens: [] })).toBeNull();
    expect(
      queuedAmeens({ credentials: { ...credentials, secret: 'short' }, pendingAmeens: ['seedA0000001'] }),
    ).toBeNull();
    expect(
      queuedAmeens({ credentials: { ...credentials, deviceId: 'not-a-uuid' }, pendingAmeens: ['seedA0000001'] }),
    ).toBeNull();
    expect(queuedAmeens({ credentials, pendingAmeens: 'seedA0000001' })).toBeNull();
    expect(queuedAmeens(undefined)).toBeNull();
    expect(queuedAmeens('device')).toBeNull();
  });
});

describe('requestBackgroundAmeens', () => {
  const container = (registration: unknown) =>
    ({ getRegistration: () => Promise.resolve(registration) }) as unknown as ServiceWorkerContainer;

  it('registers the Ameen sync where the browser has Background Sync', async () => {
    const tags: string[] = [];
    const registration = {
      active: {},
      sync: {
        register: (tag: string) => {
          tags.push(tag);
          return Promise.resolve();
        },
      },
    };
    expect(await requestBackgroundAmeens(container(registration))).toBe(true);
    expect(tags).toEqual([AMEEN_SYNC_TAG]);
  });

  it('does nothing without a worker or Background Sync, and never rejects', async () => {
    expect(await requestBackgroundAmeens(undefined)).toBe(false);
    expect(await requestBackgroundAmeens(container(undefined))).toBe(false);
    expect(await requestBackgroundAmeens(container({ active: {} }))).toBe(false);
    expect(
      await requestBackgroundAmeens(container({ active: null, sync: { register: () => Promise.resolve() } })),
    ).toBe(false);
    const failing = { active: {}, sync: { register: () => Promise.reject(new Error('NotAllowedError')) } };
    expect(await requestBackgroundAmeens(container(failing))).toBe(false);
  });
});

describe('launchAction (links that launch the open app — launch_handler focus-existing)', () => {
  const origin = 'https://app.example.test';
  const context = { origin, initialUrl: `${origin}/?source=pwa`, config: NAV_CONFIG };

  it('pushes a follow link or a post, switches tab for a tab root, presents a modal path', () => {
    expect(launchAction(`${origin}/m/TESTA001`, context)).toEqual({ kind: 'push', href: '/m/TESTA001' });
    expect(launchAction(`${origin}/p/seedA0000001?x=1#top`, context)).toEqual({
      kind: 'push',
      href: '/p/seedA0000001?x=1#top',
    });
    expect(launchAction(`${origin}/updates?source=shortcut`, context)).toEqual({ kind: 'tab', tab: 'updates' });
    expect(launchAction(`${origin}/qibla?source=shortcut`, context)).toEqual({
      kind: 'modal',
      href: '/qibla?source=shortcut',
    });
  });

  it('ignores the URL the document opened with, other origins and junk', () => {
    expect(launchAction(`${origin}/?source=pwa`, context)).toBeNull();
    expect(launchAction(`${origin}/?source=pwa`, { ...context, initialUrl: undefined })).toEqual({
      kind: 'tab',
      tab: 'home',
    });
    expect(launchAction('https://evil.example/m/TESTA001', context)).toBeNull();
    expect(launchAction('not a url', context)).toBeNull();
  });
});
