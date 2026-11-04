// @vitest-environment jsdom
import { ProblemError } from '@mc/shared/http';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as MasjidApi from '../../home/api/masjid-api.ts';
import { masjidApi } from '../../home/api/masjid-api.ts';
import { useNoticeTemplates, usePhotoUpload, usePublishNotice, useQuota } from '../hooks/use-notice.ts';
import { setNoticeDraft, useNoticeDraft } from '../lib/draft-store.ts';
import { draftForText } from '../lib/notice.ts';

vi.mock('../../home/api/masjid-api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof MasjidApi>()),
  masjidApi: { templates: vi.fn(), quota: vi.fn(), uploadImage: vi.fn(), publishAnnouncement: vi.fn() },
}));

const wrapper = (client: QueryClient) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

const BODY = {
  content: { kind: 'text', title: 'Test title', body: 'Test body', locale: 'en' },
  category: 'general',
  isImportant: false,
  notify: true,
} as const;

afterEach(() => {
  vi.resetAllMocks();
  setNoticeDraft(null);
});

// 07 B5 (T3.6): the templates and quota reads, the photo upload, the publish (and its quota refusal) and the draft
// the three screens share.
describe('notice hooks', () => {
  it('loads nothing without a masjid', () => {
    const { result } = renderHook(() => ({ templates: useNoticeTemplates(undefined), quota: useQuota(undefined) }), {
      wrapper: wrapper(client()),
    });
    expect(result.current.templates.fetchStatus).toBe('idle');
    expect(result.current.quota.fetchStatus).toBe('idle');
    expect(masjidApi.templates).not.toHaveBeenCalled();
  });

  it('loads the templates and the quota of the masjid', async () => {
    vi.mocked(masjidApi.templates).mockResolvedValue({ templates: [] });
    vi.mocked(masjidApi.quota).mockResolvedValue({ used: 1, limit: 8, resetsAt: '2026-11-04T18:30:00.000Z' });
    const { result } = renderHook(() => ({ templates: useNoticeTemplates('m1'), quota: useQuota('m1') }), {
      wrapper: wrapper(client()),
    });
    await waitFor(() => {
      expect(result.current.templates.isSuccess).toBe(true);
      expect(result.current.quota.isSuccess).toBe(true);
    });
    expect(masjidApi.templates).toHaveBeenCalledWith('m1', expect.any(AbortSignal));
    expect(result.current.quota.data?.used).toBe(1);
  });

  it('uploads a photo for the masjid', async () => {
    const stored = {
      imageKey: 'm/a/b',
      thumbhash: 'AAAA',
      width: 1,
      height: 1,
      urls: { w480: 'u480', w960: 'u960', w1440: 'u1440' },
    };
    vi.mocked(masjidApi.uploadImage).mockResolvedValue(stored);
    const { result } = renderHook(() => usePhotoUpload('m1'), { wrapper: wrapper(client()) });
    const file = new Blob(['x'], { type: 'image/png' });
    await act(() => result.current.mutateAsync(file));
    expect(masjidApi.uploadImage).toHaveBeenCalledWith('m1', file);
  });

  it('publishes and refreshes the masjid queries', async () => {
    const published = { item: { id: 'i1', publicId: 'p1' }, notification: { queued: true, targeted: 3, quotaLeft: 6 } };
    vi.mocked(masjidApi.publishAnnouncement).mockResolvedValue(published);
    const queries = client();
    const invalidate = vi.spyOn(queries, 'invalidateQueries');
    const { result } = renderHook(() => usePublishNotice('m1'), { wrapper: wrapper(queries) });
    await act(() => result.current.publish.mutateAsync(BODY));
    expect(masjidApi.publishAnnouncement).toHaveBeenCalledWith('m1', BODY);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['masjid', 'm1'] });
    expect(result.current.quotaExceeded).toBe(false);
  });

  it('reports a quota refusal', async () => {
    vi.mocked(masjidApi.publishAnnouncement).mockRejectedValue(
      new ProblemError({ type: 'about:blank', title: 'x', status: 409, code: 'NOTIFY_QUOTA_EXCEEDED' }, undefined),
    );
    const { result } = renderHook(() => usePublishNotice('m1'), { wrapper: wrapper(client()) });
    act(() => {
      result.current.publish.mutate(BODY);
    });
    await waitFor(() => {
      expect(result.current.quotaExceeded).toBe(true);
    });
  });
});

describe('the shared draft', () => {
  it('is null until set, follows every change and clears', () => {
    const { result } = renderHook(() => useNoticeDraft());
    expect(result.current).toBeNull();
    act(() => {
      setNoticeDraft(draftForText('ur'));
    });
    expect(result.current?.content).toMatchObject({ kind: 'text', locale: 'ur' });
    act(() => {
      setNoticeDraft(null);
    });
    expect(result.current).toBeNull();
  });
});
