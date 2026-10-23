// @vitest-environment jsdom
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
import { useHomeData } from '../useHomeData.ts';

// T2.6 Home data: followed ids → versions → bundle + first feed page per version; removed masjids hidden; suspended
// shown as such; recent = newest 5 across feeds; versions unavailable on a first open → `failed`.

const BASE = 'https://app.test/api/v1';
const A = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const B = '1b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e';
const GONE = '2c3d4e5f-6a7b-4c8d-8e9f-0a1b2c3d4e5f';
const server = mockNetwork();

const activeBundle = (id: string, v: number) => ({
  status: 'active',
  v,
  masjid: {
    id,
    followCode: 'TESTA001',
    name: 'Test Masjid Alpha',
    nameI18n: {},
    area: 'Area',
    city: 'City',
    state: 'State',
    verified: true,
    address: 'Address',
    lat: 17.385,
    lng: 78.4867,
    calcMethod: 'karachi',
    asrMadhab: 'hanafi',
    showChanda: false,
    chandaWeekStart: 5,
  },
  timings: null,
  specialDates: [],
  ramadan: null,
  payment: null,
  campaigns: [],
  chanda: null,
});

const item = (n: number) => ({
  publicId: `item${String(n).padStart(8, '0')}`,
  masjidId: A,
  type: 'announcement',
  audience: 'everyone',
  title: `Notice ${String(n)}`,
  isImportant: false,
  publishedAt: new Date(Date.UTC(2026, 9, 22, 10, n)).toISOString(),
});

async function setup(follows: readonly string[]) {
  const store = createDeviceStore(memoryBackend(), 'en');
  await store.load();
  await store.update((state) => ({
    ...state,
    audiencePref: 'brothers',
    follows: follows.map((masjidId) => ({
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
  return renderHook(() => useHomeData(), { wrapper });
}

describe('useHomeData', () => {
  it('nothing followed: empty', async () => {
    server.use(http.get(`${BASE}/templates`, () => HttpResponse.json({ templates: [] })));
    const { result } = await setup([]);
    expect(result.current.empty).toBe(true);
    expect(result.current.masjids).toEqual([]);
  });

  it('loads bundles and feeds by version; hides removed masjids; merges the newest 5', async () => {
    let feeds = 0;
    server.use(
      http.get(`${BASE}/templates`, () => HttpResponse.json({ templates: [] })),
      http.get(`${BASE}/masjids/versions`, () =>
        HttpResponse.json({ [A]: { v: 3, status: 'active' }, [B]: { v: 2, status: 'suspended' } }),
      ),
      http.get(`${BASE}/masjids/:id/bundle`, ({ params }) =>
        params['id'] === A ? HttpResponse.json(activeBundle(A, 3)) : HttpResponse.json({ status: 'suspended', v: 2 }),
      ),
      http.get(`${BASE}/masjids/:id/feed`, () => {
        feeds += 1;
        return HttpResponse.json({ items: [1, 2, 3, 4, 5, 6, 7].map(item), next: null });
      }),
    );
    const { result } = await setup([A, B, GONE]);
    expect(result.current.masjids.map((masjid) => masjid.state)).toEqual(['loading', 'loading', 'loading']);
    await waitFor(() => {
      expect(result.current.masjids.map((masjid) => masjid.state)).toEqual(['active', 'suspended']);
    });
    await waitFor(() => {
      expect(result.current.recent.map((entry) => entry.title)).toEqual([
        'Notice 7',
        'Notice 6',
        'Notice 5',
        'Notice 4',
        'Notice 3',
      ]);
    });
    expect(feeds).toBe(1); // only the active masjid has a feed
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.failed).toBe(false);
  });

  it('versions unavailable on a first open: failed (with a retry)', async () => {
    server.use(
      http.get(`${BASE}/templates`, () => HttpResponse.json({ templates: [] })),
      http.get(`${BASE}/masjids/versions`, () => HttpResponse.error()),
    );
    const { result } = await setup([A]);
    await waitFor(() => {
      expect(result.current.failed).toBe(true);
    });
    expect(result.current.masjids).toEqual([{ id: A, state: 'loading' }]);
  });
});
