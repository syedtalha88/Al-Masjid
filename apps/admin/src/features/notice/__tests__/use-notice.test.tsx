// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as MasjidApi from '../../home/api/masjid-api.ts';
import { masjidApi } from '../../home/api/masjid-api.ts';
import { useNoticeTemplates, usePhotoUpload } from '../hooks/use-notice.ts';
import { setNoticeDraft, useNoticeDraft } from '../lib/draft-store.ts';
import { draftForText } from '../lib/notice.ts';

vi.mock('../../home/api/masjid-api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof MasjidApi>()),
  masjidApi: { templates: vi.fn(), uploadImage: vi.fn() },
}));

const wrapper = (client: QueryClient) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

afterEach(() => {
  vi.resetAllMocks();
  setNoticeDraft(null);
});

// 07 B5 (T3.6): the templates read, the photo upload and the draft the three screens share.
describe('notice hooks', () => {
  it('loads nothing without a masjid', () => {
    const { result } = renderHook(() => useNoticeTemplates(undefined), { wrapper: wrapper(client()) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(masjidApi.templates).not.toHaveBeenCalled();
  });

  it('loads the templates of the masjid', async () => {
    vi.mocked(masjidApi.templates).mockResolvedValue({ templates: [] });
    const { result } = renderHook(() => useNoticeTemplates('m1'), { wrapper: wrapper(client()) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(masjidApi.templates).toHaveBeenCalledWith('m1', expect.any(AbortSignal));
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
