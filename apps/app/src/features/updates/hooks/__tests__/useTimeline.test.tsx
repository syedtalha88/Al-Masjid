// @vitest-environment jsdom
import type { ItemType } from '@mc/shared/contracts/public';
import { useMockNetwork as mockNetwork } from '@mc/shared/testing/msw';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { createApiClient } from '../../../../lib/api/client.ts';
import { type AppData, AppDataContext } from '../../../../lib/data.tsx';
import { createDeviceStore, memoryBackend } from '../../../../lib/device/store.ts';
import { createQueryClient } from '../../../../lib/query/persist.ts';
import { useTimeline } from '../useTimeline.ts';

// T2.10 Updates data: two masjids paged separately (3 per page) merge newest first; loadMore pages the masjid holding
// the merge back; a type filter starts over.

const BASE = 'https://app.test/api/v1';
const A = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const B = '1b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e';
const server = mockNetwork();

/** A masjid's items: one per hour, the given hours (newest first), as `id-hour`. */
const itemsOf = (masjidId: string, hours: readonly number[], type = 'announcement') =>
  hours.map((hour) => ({
    publicId: `${masjidId.slice(0, 8)}${String(hour).padStart(4, '0')}`, // 12 characters
    masjidId,
    type,
    audience: 'everyone',
    isImportant: false,
    publishedAt: new Date(Date.UTC(2026, 9, 22, hour)).toISOString(),
  }));
const FEEDS: Record<string, ReturnType<typeof itemsOf>> = {
  [A]: itemsOf(A, [23, 20, 17, 14, 11, 8]),
  [B]: itemsOf(B, [22, 21, 3]),
};

async function setup() {
  server.use(
    http.get(`${BASE}/masjids/versions`, () =>
      HttpResponse.json({ [A]: { v: 1, status: 'active' }, [B]: { v: 1, status: 'active' } }),
    ),
    http.get(`${BASE}/masjids/:id/feed`, ({ params, request }) => {
      const url = new URL(request.url);
      const type = url.searchParams.get('type');
      const all = (FEEDS[String(params['id'])] ?? []).filter((item) => !type || item.type === type);
      const start = Number(url.searchParams.get('cursor') ?? '0');
      const page = all.slice(start, start + 3);
      return HttpResponse.json({ items: page, next: start + 3 < all.length ? String(start + 3) : null });
    }),
  );
  const store = createDeviceStore(memoryBackend(), 'en');
  await store.load();
  await store.update((state) => ({
    ...state,
    audiencePref: 'brothers',
    follows: [A, B].map((masjidId) => ({
      masjidId,
      followedAt: '2026-10-01T00:00:00.000Z',
      muted: false,
      sync: 'synced' as const,
    })),
  }));
  const api = createApiClient({ base: BASE, credentials: () => undefined, backoff: () => Promise.resolve() });
  const queryClient = createQueryClient();
  const data: AppData = {
    store,
    api,
    queryClient,
    sync: { store, api, turnstileToken: () => Promise.resolve('x'), platform: 'android' },
  };
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <AppDataContext value={data}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AppDataContext>
  );
  return renderHook<ReturnType<typeof useTimeline>, { type: ItemType | undefined }>(({ type }) => useTimeline(type), {
    wrapper,
    initialProps: { type: undefined },
  });
}

const hours = (items: readonly { publishedAt: string }[]) =>
  items.map((item) => new Date(item.publishedAt).getUTCHours());

describe('useTimeline', () => {
  it('merges first pages, then pages the masjid holding the merge back until everything is in', async () => {
    const { result } = await setup();
    expect(result.current.loading).toBe(true);
    // A's first page ends at 17h, B's (complete) at 3h: only items ≥ 17h are certain.
    await waitFor(() => {
      expect(hours(result.current.items)).toEqual([23, 22, 21, 20, 17]);
    });
    expect(result.current.hasMore).toBe(true);
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => {
      expect(hours(result.current.items)).toEqual([23, 22, 21, 20, 17, 14, 11, 8, 3]);
    });
    expect(result.current.hasMore).toBe(false);
    act(() => {
      result.current.loadMore(); // nothing left
    });
    expect(result.current.empty).toBe(false);
  });

  it('a filter starts over with that type only', async () => {
    const { result, rerender } = await setup();
    await waitFor(() => {
      expect(result.current.items.length).toBeGreaterThan(0);
    });
    rerender({ type: 'video' });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.items).toEqual([]);
  });
});
