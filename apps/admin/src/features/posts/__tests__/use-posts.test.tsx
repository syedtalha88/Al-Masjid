// @vitest-environment jsdom
import { ProblemError } from '@mc/shared/http';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as MasjidApi from '../../home/api/masjid-api.ts';
import { masjidApi } from '../../home/api/masjid-api.ts';
import { useEditItem } from '../../publish/use-publish.ts';
import { useDeletePost, usePosts } from '../hooks/use-posts.ts';

vi.mock('../../home/api/masjid-api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof MasjidApi>()),
  masjidApi: { items: vi.fn(), deleteItem: vi.fn(), editItem: vi.fn() },
}));

const wrapper = (client: QueryClient) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const EDITING = { itemId: 'i1', updatedAt: '2026-11-04T06:30:00.000Z' };
const BODY = { type: 'daily_content', libraryId: '0b7f6c2e-1d4a-4f3b-9c8e-2a1b3c4d5e6f' } as const;

afterEach(() => {
  vi.resetAllMocks();
});

// 07 B12 (T3.9): the posts per type chip, page by page; deleting; saving an edit (and the 412 when someone saved first).
describe('posts hooks', () => {
  it('loads the posts of a type and pages with the cursor; "all" sends no type', async () => {
    vi.mocked(masjidApi.items)
      .mockResolvedValueOnce({ items: [], next: 'c2' })
      .mockResolvedValueOnce({ items: [], next: null });
    const { result } = renderHook(() => usePosts('m1', 'dua_request'), { wrapper: wrapper(client()) });
    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(true);
    });
    expect(masjidApi.items).toHaveBeenCalledWith('m1', { type: 'dua_request' }, expect.any(AbortSignal));
    await act(() => result.current.fetchNextPage());
    expect(masjidApi.items).toHaveBeenLastCalledWith(
      'm1',
      { type: 'dua_request', cursor: 'c2' },
      expect.any(AbortSignal),
    );
    vi.mocked(masjidApi.items).mockResolvedValue({ items: [], next: null });
    const all = renderHook(() => usePosts('m1', 'all'), { wrapper: wrapper(client()) });
    await waitFor(() => {
      expect(all.result.current.isSuccess).toBe(true);
    });
    expect(masjidApi.items).toHaveBeenLastCalledWith('m1', {}, expect.any(AbortSignal));
    const idle = renderHook(() => usePosts(undefined, 'all'), { wrapper: wrapper(client()) });
    expect(idle.result.current.fetchStatus).toBe('idle');
  });

  it('deletes and refreshes the masjid queries', async () => {
    vi.mocked(masjidApi.deleteItem).mockResolvedValue(undefined);
    const queries = client();
    const invalidate = vi.spyOn(queries, 'invalidateQueries');
    const { result } = renderHook(() => useDeletePost('m1'), { wrapper: wrapper(queries) });
    await act(() => result.current.mutateAsync('i1'));
    expect(masjidApi.deleteItem).toHaveBeenCalledWith('m1', 'i1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['masjid', 'm1'] });
  });

  it('saves an edit at its updatedAt; a 412 is reported as stale', async () => {
    vi.mocked(masjidApi.editItem).mockResolvedValueOnce({ updatedAt: '2026-11-04T07:00:00.000Z' });
    const { result } = renderHook(() => useEditItem('m1'), { wrapper: wrapper(client()) });
    await act(() => result.current.save.mutateAsync({ editing: EDITING, body: BODY }));
    expect(masjidApi.editItem).toHaveBeenCalledWith('m1', 'i1', EDITING.updatedAt, BODY);
    expect(result.current.stale).toBe(false);
    vi.mocked(masjidApi.editItem).mockRejectedValueOnce(
      new ProblemError({ type: 'about:blank', title: 'x', status: 412, code: 'PRECONDITION_FAILED' }, undefined),
    );
    act(() => {
      result.current.save.mutate({ editing: EDITING, body: BODY });
    });
    await waitFor(() => {
      expect(result.current.stale).toBe(true);
    });
  });
});
