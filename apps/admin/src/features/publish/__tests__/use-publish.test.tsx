// @vitest-environment jsdom
import { ProblemError } from '@mc/shared/http';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as MasjidApi from '../../home/api/masjid-api.ts';
import { masjidApi } from '../../home/api/masjid-api.ts';
import { createDraftStore } from '../draft-store.ts';
import { usePublishItem, useQuota } from '../use-publish.ts';

vi.mock('../../home/api/masjid-api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof MasjidApi>()),
  masjidApi: { quota: vi.fn() },
}));

const wrapper = (client: QueryClient) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const PUBLISHED = { item: { id: 'i1', publicId: 'p1' }, notification: { queued: true, targeted: 3, quotaLeft: 6 } };

afterEach(() => {
  vi.resetAllMocks();
});

// 07 B5–B7: the quota read and the publish moment every flow shares (and its quota refusal), and the flow draft store.
describe('publish hooks', () => {
  it('reads the quota of the masjid, nothing without one', async () => {
    vi.mocked(masjidApi.quota).mockResolvedValue({ used: 1, limit: 8, resetsAt: '2026-11-04T18:30:00.000Z' });
    const idle = renderHook(() => useQuota(undefined), { wrapper: wrapper(client()) });
    expect(idle.result.current.fetchStatus).toBe('idle');
    const { result } = renderHook(() => useQuota('m1'), { wrapper: wrapper(client()) });
    await waitFor(() => {
      expect(result.current.data?.used).toBe(1);
    });
    expect(masjidApi.quota).toHaveBeenCalledWith('m1', expect.any(AbortSignal));
  });

  it('publishes with the given call and refreshes the masjid queries', async () => {
    const send = vi.fn().mockResolvedValue(PUBLISHED);
    const queries = client();
    const invalidate = vi.spyOn(queries, 'invalidateQueries');
    const { result } = renderHook(() => usePublishItem('m1', send), { wrapper: wrapper(queries) });
    await act(() => result.current.publish.mutateAsync({ any: 'body' }));
    expect(send).toHaveBeenCalledWith('m1', { any: 'body' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['masjid', 'm1'] });
    expect(result.current.quotaExceeded).toBe(false);
  });

  it('reports a quota refusal', async () => {
    const send = vi
      .fn()
      .mockRejectedValue(
        new ProblemError({ type: 'about:blank', title: 'x', status: 409, code: 'NOTIFY_QUOTA_EXCEEDED' }, undefined),
      );
    const { result } = renderHook(() => usePublishItem('m1', send), { wrapper: wrapper(client()) });
    act(() => {
      result.current.publish.mutate({});
    });
    await waitFor(() => {
      expect(result.current.quotaExceeded).toBe(true);
    });
  });
});

describe('createDraftStore', () => {
  it('is null until set, follows every change and clears; stores are separate', () => {
    const one = createDraftStore<{ n: number }>();
    const two = createDraftStore<{ n: number }>();
    const { result } = renderHook(() => ({ one: one.useDraft(), two: two.useDraft() }));
    expect(result.current.one).toBeNull();
    act(() => {
      one.set({ n: 1 });
    });
    expect(result.current).toEqual({ one: { n: 1 }, two: null });
    act(() => {
      one.set(null);
    });
    expect(result.current.one).toBeNull();
  });
});
