// @vitest-environment jsdom
import type { NavigatorApi } from '@mc/ui/navigation';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '../api/client.ts';
import { type AppData, AppDataContext } from '../data.tsx';
import { createDeviceStore, memoryBackend } from '../device/store.ts';
import { usePushBridge } from '../push-bridge.ts';
import { createQueryClient } from '../query/persist.ts';
import { PUSH_OPEN, PUSH_RECEIVED } from '../sw-protocol.ts';

// PHASE_04 T4.3 (verifier gap, DECISIONS #143): the page side of a notification — a tapped one opens its item (or the
// Updates tab), any push refreshes the masjid versions, unchecked worker messages are ignored, and the app badge
// follows the unseen count.

const MASJID = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';

let worker: EventTarget;
const badge = { set: vi.fn((_count: number) => Promise.resolve()), clear: vi.fn(() => Promise.resolve()) };

beforeEach(() => {
  worker = new EventTarget();
  Object.defineProperty(navigator, 'serviceWorker', { value: worker, configurable: true });
  Object.defineProperty(navigator, 'setAppBadge', { value: badge.set, configurable: true });
  Object.defineProperty(navigator, 'clearAppBadge', { value: badge.clear, configurable: true });
  badge.set.mockClear();
  badge.clear.mockClear();
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(navigator, 'setAppBadge');
  Reflect.deleteProperty(navigator, 'clearAppBadge');
});

async function setup(unseen = 0) {
  const store = createDeviceStore(memoryBackend(), 'en');
  await store.load();
  const api = createApiClient({ base: 'https://app.test/api/v1', credentials: () => undefined });
  const queryClient = createQueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
  const data: AppData = {
    store,
    api,
    queryClient,
    sync: { store, api, turnstileToken: () => Promise.resolve('x'), platform: 'android' },
  };
  const nav = { push: vi.fn(), selectTab: vi.fn() };
  const navigator_ = nav as unknown as NavigatorApi; // only push / selectTab are used by the bridge
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <AppDataContext value={data}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AppDataContext>
  );
  const hook = renderHook(
    ({ count }: { count: number }) => {
      usePushBridge(navigator_, count);
    },
    { wrapper, initialProps: { count: unseen } },
  );
  const send = (data: unknown) => worker.dispatchEvent(new MessageEvent('message', { data }));
  return { hook, nav, invalidate, send };
}

describe('usePushBridge', () => {
  it('a tapped notification opens its item; one for Updates selects the tab; both refresh the versions', async () => {
    const { nav, invalidate, send } = await setup();
    send({ type: PUSH_OPEN, url: '/items/seedA0000001', masjidId: MASJID });
    expect(nav.push).toHaveBeenCalledWith('/items/seedA0000001');
    send({ type: PUSH_OPEN, url: '/updates' });
    expect(nav.selectTab).toHaveBeenCalledWith('updates');
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['versions'] });
  });

  it('a push that arrives only refreshes the versions; unchecked messages are ignored', async () => {
    const { nav, invalidate, send } = await setup();
    send({ type: PUSH_RECEIVED, masjidId: MASJID });
    expect(invalidate).toHaveBeenCalledTimes(1);
    send({ type: PUSH_OPEN, url: 'https://evil.example/items/seedA0000001' });
    send({ type: PUSH_OPEN, url: 'javascript:alert(1)' });
    send({ type: PUSH_RECEIVED, masjidId: 'not-an-id' });
    send('PUSH_OPEN');
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(nav.push).not.toHaveBeenCalled();
    expect(nav.selectTab).not.toHaveBeenCalled();
  });

  it('the app badge follows the unseen count and stops listening on unmount', async () => {
    const { hook, nav, send } = await setup(3);
    expect(badge.set).toHaveBeenCalledWith(3);
    hook.rerender({ count: 0 });
    expect(badge.clear).toHaveBeenCalled();
    hook.unmount();
    send({ type: PUSH_OPEN, url: '/updates' });
    expect(nav.selectTab).not.toHaveBeenCalled();
  });
});
