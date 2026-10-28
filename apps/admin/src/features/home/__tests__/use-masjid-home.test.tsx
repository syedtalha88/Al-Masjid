// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as MasjidApi from '../api/masjid-api.ts';
import { masjidApi } from '../api/masjid-api.ts';
import { useMasjidHome } from '../hooks/use-masjid-home.ts';

vi.mock('../api/masjid-api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof MasjidApi>()),
  masjidApi: { stats: vi.fn(), quota: vi.fn(), schedule: vi.fn() },
}));

const wrapper = (client: QueryClient) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

afterEach(() => {
  vi.resetAllMocks();
});

// 07 B3: stats, quota and schedule load independently; nothing loads before a masjid is selected.
describe('useMasjidHome', () => {
  it('loads nothing without a masjid', () => {
    const { result } = renderHook(() => useMasjidHome(undefined), { wrapper: wrapper(client()) });
    expect(result.current.stats.fetchStatus).toBe('idle');
    expect(masjidApi.stats).not.toHaveBeenCalled();
    expect(masjidApi.quota).not.toHaveBeenCalled();
    expect(masjidApi.schedule).not.toHaveBeenCalled();
  });

  it('loads the three parts for the masjid; a failed part fails alone', async () => {
    vi.mocked(masjidApi.stats).mockResolvedValue({ followers: 3, itemsThisWeek: 1, ameenThisWeek: 0 });
    vi.mocked(masjidApi.quota).mockRejectedValue(new Error('down'));
    vi.mocked(masjidApi.schedule).mockResolvedValue({
      masjid: { name: 'Test Masjid Alpha', lat: 17.385, lng: 78.4867, calcMethod: 'karachi', asrMadhab: 'hanafi' },
      timings: null,
    });
    const { result } = renderHook(() => useMasjidHome('m1'), { wrapper: wrapper(client()) });
    await waitFor(() => {
      expect(result.current.stats.isSuccess).toBe(true);
      expect(result.current.quota.isError).toBe(true);
      expect(result.current.schedule.isSuccess).toBe(true);
    });
    expect(result.current.stats.data?.followers).toBe(3);
    expect(masjidApi.stats).toHaveBeenCalledWith('m1', expect.any(AbortSignal));
    expect(masjidApi.quota).toHaveBeenCalledWith('m1', expect.any(AbortSignal));
    expect(masjidApi.schedule).toHaveBeenCalledWith('m1', expect.any(AbortSignal));
  });
});
