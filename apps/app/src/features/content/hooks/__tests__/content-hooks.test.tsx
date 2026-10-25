// @vitest-environment jsdom
import { createI18n } from '@mc/i18n';
import { I18nProvider } from '@mc/i18n/react';
import type { FeedItem } from '@mc/shared/contracts/public';
import { useMockNetwork as mockNetwork } from '@mc/shared/testing/msw';
import { ToastProvider } from '@mc/ui/components';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '../../../../lib/api/client.ts';
import { queryKeys } from '../../../../lib/api/keys.ts';
import { type AppData, AppDataContext } from '../../../../lib/data.tsx';
import { createDeviceStore, memoryBackend } from '../../../../lib/device/store.ts';
import { createQueryClient } from '../../../../lib/query/persist.ts';
import { useAmeen } from '../useAmeen.ts';
import { findCachedItem, useItem } from '../useItem.ts';
import { useNoticeBody } from '../useNoticeBody.ts';
import { useSaved } from '../useSaved.ts';
import { useSection } from '../useSection.ts';
import { useShareItem } from '../useShareItem.ts';

// T2.11 content hooks (07 A7–A9): item from cache or API, Ameen state, Saved, template bodies, section data, share.
// Religious text: the 10 §5 placeholders only.

const BASE = 'https://app.test/api/v1';
const A = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const OTHER = '1b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e';
const DEVICE = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const server = mockNetwork();
/** Confirmed counts are kept for the session (module state): each test says Ameen on its own item. */
const QUEUED = 'duaBBBBBBBBB';

const profile = (id: string, name: string) => ({
  id,
  followCode: 'TESTA001',
  name,
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
});
const bundle = (id: string, status: 'active' | 'suspended' = 'active') =>
  status === 'suspended'
    ? { status, v: 1 }
    : {
        status,
        v: 1,
        masjid: profile(id, 'Test Masjid Alpha'),
        timings: null,
        specialDates: [],
        ramadan: null,
        payment: null,
        campaigns: [],
        chanda: null,
      };

const LIBRARY = {
  id: '00000000-0000-4000-8000-0000000000aa',
  kind: 'dua',
  arabic: 'نص تجريبي للعرض فقط',
  transliteration: { en: 'Sample transliteration — DEV ONLY' },
  translation: { en: 'Sample translation text for development. Not a real hadith.' },
  reference: 'DEV-SAMPLE-001',
  sourceName: 'Development fixture',
  sourceLicense: 'N/A — not for production',
} as const;

const DUA: FeedItem = {
  publicId: 'duaAAAAAAAAA',
  masjidId: A,
  type: 'dua_request',
  audience: 'everyone',
  body: 'Please make dua.',
  isImportant: false,
  publishedAt: '2026-10-24T05:00:00.000Z',
  dua: { category: 'illness', namePrivate: true, library: LIBRARY },
};
const NOTICE: FeedItem = {
  publicId: 'noticeAAAAAA',
  masjidId: A,
  type: 'announcement',
  audience: 'everyone',
  templateKey: 'no_water',
  templateParams: { hours: { start: '10:00', end: '14:00' } },
  isImportant: true,
  publishedAt: '2026-10-24T06:00:00.000Z',
  announcement: { category: 'facilities' },
};
const TEMPLATE = {
  key: 'no_water',
  category: 'facilities',
  icon: 'drop',
  isImportantDefault: true,
  title: { en: 'No water supply', hi: 'x', ur: 'x', te: 'x' },
  body: { en: 'Water will not be available from {hours_start} to {hours_end}.', hi: '', ur: '', te: '' },
  params: [{ name: 'hours', type: 'time_range', required: true }],
  system: true,
};

interface SetupOptions {
  readonly follow?: boolean;
  readonly registered?: boolean;
  readonly status?: 'active' | 'suspended';
}

async function setup({ follow = true, registered = true, status = 'active' }: SetupOptions = {}) {
  const ameens = new Map<string, number>([
    [DUA.publicId, 4],
    [QUEUED, 4],
  ]);
  server.use(
    http.get(`${BASE}/masjids/versions`, () => HttpResponse.json({ [A]: { v: 1, status } })),
    http.get(`${BASE}/masjids/:id/bundle`, ({ params }) => HttpResponse.json(bundle(String(params['id']), status))),
    http.get(`${BASE}/masjids/:id/feed`, () => HttpResponse.json({ items: [NOTICE, DUA], next: null })),
    http.get(`${BASE}/templates`, () => HttpResponse.json({ templates: [TEMPLATE] })),
    http.get(`${BASE}/ameens`, ({ request }) => {
      const ids = (new URL(request.url).searchParams.get('items') ?? '').split(',');
      return HttpResponse.json({
        counts: Object.fromEntries(ids.flatMap((id) => (ameens.has(id) ? [[id, ameens.get(id)]] : []))),
      });
    }),
    http.post(`${BASE}/items/:id/ameen`, ({ params }) => {
      const id = String(params['id']);
      const count = (ameens.get(id) ?? 0) + 1;
      ameens.set(id, count);
      return HttpResponse.json({ count });
    }),
  );
  const store = createDeviceStore(memoryBackend(), 'en');
  await store.load();
  await store.update((state) => ({
    ...state,
    audiencePref: 'brothers',
    ...(registered ? { credentials: { deviceId: DEVICE, secret: 'S'.repeat(43) } } : {}),
    follows: follow
      ? [{ masjidId: A, followedAt: '2026-10-01T00:00:00.000Z', muted: false, sync: 'synced' as const }]
      : [],
  }));
  const api = createApiClient({
    base: BASE,
    credentials: () => store.current().credentials,
    backoff: () => Promise.resolve(),
  });
  const queryClient = createQueryClient();
  const data: AppData = {
    store,
    api,
    queryClient,
    sync: { store, api, turnstileToken: () => Promise.resolve('x'), platform: 'android' },
  };
  const i18n = await createI18n('en', ['common', 'errors', 'content', 'masjid']);
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <I18nProvider instance={i18n} initialLocale="en">
      <AppDataContext value={data}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      </AppDataContext>
    </I18nProvider>
  );
  return { data, wrapper, ameens };
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'share');
});

describe('useItem', () => {
  it('takes a listed item from the cached feed pages (no request) with its followed masjid', async () => {
    const { data, wrapper } = await setup();
    const requests: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.url.includes('/items/')) requests.push(request.url);
    });
    data.queryClient.setQueryData(queryKeys.feed(A, 1, 'brothers'), { items: [NOTICE], next: null });
    expect(findCachedItem(data.queryClient, NOTICE.publicId)).toEqual(NOTICE);
    const { result } = renderHook(() => useItem(NOTICE.publicId), { wrapper });
    await waitFor(() => {
      expect(result.current).toMatchObject({ state: 'ready', item: NOTICE, masjid: { name: 'Test Masjid Alpha' } });
    });
    expect(requests).toEqual([]);
  });

  it('fetches a linked item with its masjid; 404 → gone; server trouble → failed with retry', async () => {
    const { wrapper } = await setup({ follow: false });
    let answer: 'ok' | 'gone' | 'fail' = 'ok';
    server.use(
      http.get(`${BASE}/items/:id`, () => {
        if (answer === 'gone') {
          return HttpResponse.json(
            { type: 'about:blank', title: 'x', status: 404, code: 'ITEM_NOT_FOUND' },
            { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
          );
        }
        if (answer === 'fail') return HttpResponse.error();
        return HttpResponse.json({ item: DUA, masjid: profile(A, 'Linked Masjid') });
      }),
    );
    const ok = renderHook(() => useItem(DUA.publicId), { wrapper });
    expect(ok.result.current.state).toBe('loading');
    await waitFor(() => {
      expect(ok.result.current).toMatchObject({ state: 'ready', masjid: { name: 'Linked Masjid' } });
    });
    answer = 'gone';
    const gone = renderHook(() => useItem('goneAAAAAAAA'), { wrapper });
    await waitFor(() => {
      expect(gone.result.current.state).toBe('gone');
    });
    answer = 'fail';
    const failed = renderHook(() => useItem('failAAAAAAAA'), { wrapper });
    await waitFor(() => {
      expect(failed.result.current.state).toBe('failed');
    });
    answer = 'ok';
    act(() => {
      if (failed.result.current.state === 'failed') failed.result.current.retry();
    });
    await waitFor(() => {
      expect(failed.result.current.state).toBe('ready');
    });
  });
});

describe('useAmeen', () => {
  it('shows the live count, says Ameen once (optimistic, then the confirmed count)', async () => {
    const { data, wrapper, ameens } = await setup();
    const ids = [DUA.publicId, 'quietAAAAAAA'];
    const { result } = renderHook(() => useAmeen(ids), { wrapper });
    await waitFor(() => {
      expect(result.current.count(DUA.publicId)).toBe(4);
    });
    expect(result.current.count('quietAAAAAAA')).toBe(0);
    expect(result.current.said(DUA.publicId)).toBe(false);
    act(() => {
      result.current.say(DUA.publicId);
    });
    await waitFor(() => {
      expect(result.current.said(DUA.publicId)).toBe(true);
    });
    await waitFor(() => {
      expect(data.store.current().pendingAmeens).toEqual([]);
    });
    expect(ameens.get(DUA.publicId)).toBe(5);
    expect(result.current.count(DUA.publicId)).toBe(5);
    // Once per device.
    act(() => {
      result.current.say(DUA.publicId);
    });
    await waitFor(() => {
      expect(ameens.get(DUA.publicId)).toBe(5);
    });
  });

  it('unregistered: queued, the count shows our Ameen on top of the live one', async () => {
    const { data, wrapper } = await setup({ registered: false });
    const { result } = renderHook(() => useAmeen([QUEUED]), { wrapper });
    await waitFor(() => {
      expect(result.current.count(QUEUED)).toBe(4);
    });
    act(() => {
      result.current.say(QUEUED);
    });
    await waitFor(() => {
      expect(data.store.current().pendingAmeens).toEqual([QUEUED]);
    });
    expect(result.current.count(QUEUED)).toBe(5);
  });
});

describe('useSaved', () => {
  it('saves on this phone (newest first, item kept for offline), and removes again', async () => {
    const { data, wrapper } = await setup();
    const { result } = renderHook(() => useSaved({ saved: 'Saved', removed: 'Removed' }), { wrapper });
    act(() => {
      result.current.toggle(DUA, profile(A, 'Test Masjid Alpha'));
    });
    await waitFor(() => {
      expect(result.current.isSaved(DUA.publicId)).toBe(true);
    });
    expect(data.queryClient.getQueryData(queryKeys.item(DUA.publicId, 'brothers'))).toMatchObject({ item: DUA });
    act(() => {
      result.current.toggle(DUA, null);
    });
    await waitFor(() => {
      expect(result.current.isSaved(DUA.publicId)).toBe(false);
    });
    expect(data.store.current().saved).toEqual([]);
  });
});

describe('useNoticeBody', () => {
  it('free text as written; a template body filled with params formatted for the locale', async () => {
    const { wrapper } = await setup();
    const { templateKey: _key, templateParams: _params, ...own } = NOTICE;
    const ownWords: FeedItem = { ...own, body: 'Own words' };
    const free = renderHook(() => useNoticeBody(ownWords), { wrapper });
    expect(free.result.current).toBe('Own words');
    const blank = renderHook(() => useNoticeBody({ ...DUA, body: '  ' }), { wrapper });
    expect(blank.result.current).toBeUndefined();
    const template = renderHook(() => useNoticeBody(NOTICE), { wrapper });
    await waitFor(() => {
      expect(template.result.current).toMatch(/^Water will not be available from 10:00\sAM to 2:00\sPM\.$/);
    });
  });
});

describe('useSection', () => {
  it('one masjid’s items of one type, with its name; suspended → unavailable', async () => {
    const { wrapper } = await setup();
    const { result } = renderHook(() => useSection(A, 'announcement'), { wrapper });
    await waitFor(() => {
      expect(result.current.name).toBe('Test Masjid Alpha');
    });
    await waitFor(() => {
      expect(result.current.timeline.items.length).toBeGreaterThan(0);
    });
    expect(result.current.profile?.id).toBe(A);
    expect(result.current.unavailable).toBeUndefined();

    const suspended = await setup({ status: 'suspended' });
    const other = renderHook(() => useSection(A, 'announcement'), { wrapper: suspended.wrapper });
    await waitFor(() => {
      expect(other.result.current.unavailable).toBe('This masjid is temporarily unavailable');
    });
  });

  it('a masjid that is not followed is fetched on its own', async () => {
    const { wrapper } = await setup({ follow: false });
    const { result } = renderHook(() => useSection(A, 'dua_request'), { wrapper });
    await waitFor(() => {
      expect(result.current.name).toBe('Test Masjid Alpha');
    });
    expect(OTHER).not.toBe(A);
  });
});

describe('useShareItem', () => {
  it('the post link and "<title> — <masjid>"; our sheet without Web Share, the system sheet with it', async () => {
    const { wrapper } = await setup();
    const { result } = renderHook(() => useShareItem(), { wrapper });
    await waitFor(() => {
      result.current.open(NOTICE, profile(A, 'Test Masjid Alpha'));
      expect(result.current.target).toMatchObject({
        url: `${window.location.origin}/p/${NOTICE.publicId}`,
        text: 'No water supply — Test Masjid Alpha',
      });
    });
    act(() => {
      result.current.close();
    });
    expect(result.current.target).toBeNull();

    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    act(() => {
      result.current.open(DUA, null);
    });
    await waitFor(() => {
      expect(share).toHaveBeenCalledWith(
        expect.objectContaining({ url: `${window.location.origin}/p/${DUA.publicId}` }),
      );
    });
    expect(result.current.target).toBeNull();
  });
});
