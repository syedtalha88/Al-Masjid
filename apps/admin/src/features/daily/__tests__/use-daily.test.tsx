// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as MasjidApi from '../../home/api/masjid-api.ts';
import { masjidApi } from '../../home/api/masjid-api.ts';
import { useLibrarySearch, useSuggestion } from '../hooks/use-daily.ts';

vi.mock('../../home/api/masjid-api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof MasjidApi>()),
  masjidApi: { suggestion: vi.fn(), library: vi.fn() },
}));

const wrapper = (client: QueryClient) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

afterEach(() => {
  vi.resetAllMocks();
});

// 07 B6 (T3.7): today's suggestion per kind and the "Choose another" search, page by page.
describe('daily hooks', () => {
  it("loads today's suggestion of the kind; nothing without a masjid", async () => {
    vi.mocked(masjidApi.suggestion).mockResolvedValue({ entry: null, publishedToday: true });
    const idle = renderHook(() => useSuggestion(undefined, 'hadith'), { wrapper: wrapper(client()) });
    expect(idle.result.current.fetchStatus).toBe('idle');
    const { result } = renderHook(() => useSuggestion('m1', 'ayah'), { wrapper: wrapper(client()) });
    await waitFor(() => {
      expect(result.current.data?.publishedToday).toBe(true);
    });
    expect(masjidApi.suggestion).toHaveBeenCalledWith('m1', 'ayah', expect.any(AbortSignal));
  });

  it('searches only while enabled, sends words and topic, and pages with the cursor', async () => {
    vi.mocked(masjidApi.library)
      .mockResolvedValueOnce({ entries: [], next: 'c2' })
      .mockResolvedValueOnce({ entries: [] });
    const closed = renderHook(() => useLibrarySearch('m1', { kind: 'hadith', q: '', tag: '' }, false), {
      wrapper: wrapper(client()),
    });
    expect(closed.result.current.fetchStatus).toBe('idle');
    const { result } = renderHook(() => useLibrarySearch('m1', { kind: 'hadith', q: 'test', tag: 'patience' }, true), {
      wrapper: wrapper(client()),
    });
    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(true);
    });
    expect(masjidApi.library).toHaveBeenCalledWith(
      'm1',
      { kind: 'hadith', q: 'test', tag: 'patience' },
      expect.any(AbortSignal),
    );
    await act(() => result.current.fetchNextPage());
    expect(masjidApi.library).toHaveBeenLastCalledWith(
      'm1',
      { kind: 'hadith', q: 'test', tag: 'patience', cursor: 'c2' },
      expect.any(AbortSignal),
    );
    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(false);
    });
  });
});
