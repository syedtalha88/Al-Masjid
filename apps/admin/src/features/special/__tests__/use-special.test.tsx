// @vitest-environment jsdom
// 07 B11 (T3.3, PROGRESS F50): special dates and Ramadan — the list loads for the selected masjid only, a save goes to
// POST (new) or PATCH (an entry) and refreshes the masjid's queries, a used-up notification quota is named, a delete
// leaves the refresh to its caller, and a Ramadan save becomes the cached Ramadan settings at once.
import type { Ramadan, SpecialDateSave } from '@mc/shared/contracts';
import { ProblemError } from '@mc/shared/http';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as MasjidApi from '../../home/api/masjid-api.ts';
import { masjidApi, masjidKeys } from '../../home/api/masjid-api.ts';
import { useRamadan, useSpecialDates, useSpecialDateWrites } from '../hooks/use-special.ts';

vi.mock('../../home/api/masjid-api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof MasjidApi>()),
  masjidApi: {
    specialDates: vi.fn(),
    saveSpecialDate: vi.fn(),
    deleteSpecialDate: vi.fn(),
    ramadan: vi.fn(),
    saveRamadan: vi.fn(),
  },
}));

const ENTRY: SpecialDateSave = {
  type: 'eid_ul_fitr',
  date: '2027-03-10',
  label: 'Test label',
  times: [{ time: '07:30' }],
  notify: false,
};

function setup<T>(hook: () => T) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, invalidate, ...renderHook(hook, { wrapper }) };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('special date hooks', () => {
  it('loads the list of the selected masjid; nothing without one', async () => {
    vi.mocked(masjidApi.specialDates).mockResolvedValue({ specialDates: [] });
    const idle = setup(() => useSpecialDates(undefined));
    expect(idle.result.current.fetchStatus).toBe('idle');
    const { result } = setup(() => useSpecialDates('m1'));
    await waitFor(() => {
      expect(result.current.data).toEqual({ specialDates: [] });
    });
    expect(masjidApi.specialDates).toHaveBeenCalledWith('m1', expect.any(AbortSignal));
  });

  it('saves a new entry and an existing one, each refreshing the masjid’s queries; names a used-up quota', async () => {
    vi.mocked(masjidApi.saveSpecialDate).mockResolvedValue({ id: 's1', item: null });
    const { result, invalidate } = setup(() => useSpecialDateWrites('m1'));
    await act(() => result.current.save.mutateAsync({ entryId: null, body: ENTRY }));
    expect(masjidApi.saveSpecialDate).toHaveBeenLastCalledWith('m1', null, ENTRY);
    await act(() => result.current.save.mutateAsync({ entryId: 's1', body: ENTRY }));
    expect(masjidApi.saveSpecialDate).toHaveBeenLastCalledWith('m1', 's1', ENTRY);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: masjidKeys.all('m1') });
    expect(result.current.quotaExceeded).toBe(false);

    vi.mocked(masjidApi.saveSpecialDate).mockRejectedValueOnce(
      new ProblemError({ type: 'about:blank', title: 'x', status: 409, code: 'NOTIFY_QUOTA_EXCEEDED' }, undefined),
    );
    await act(async () => {
      await result.current.save.mutateAsync({ entryId: null, body: { ...ENTRY, notify: true } }).catch(() => undefined);
    });
    await waitFor(() => {
      expect(result.current.quotaExceeded).toBe(true);
    });
  });

  it('a delete does not refresh by itself (its screen leaves first, then calls refresh)', async () => {
    vi.mocked(masjidApi.deleteSpecialDate).mockResolvedValue(undefined);
    const { result, invalidate } = setup(() => useSpecialDateWrites('m1'));
    await act(() => result.current.remove.mutateAsync('s1'));
    expect(masjidApi.deleteSpecialDate).toHaveBeenCalledWith('m1', 's1');
    expect(invalidate).not.toHaveBeenCalled();
    await act(() => result.current.refresh());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: masjidKeys.all('m1') });
  });

  it('Ramadan: loads the settings; a save becomes the cached settings at once', async () => {
    const off: Ramadan = { start: null, end: null, sehriPrecaution: 5, iftarPrecaution: 2 };
    const on: Ramadan = { start: '2027-02-08', end: '2027-03-09', sehriPrecaution: 5, iftarPrecaution: 2 };
    vi.mocked(masjidApi.ramadan).mockResolvedValue(off);
    vi.mocked(masjidApi.saveRamadan).mockResolvedValue(on);
    const { result, client } = setup(() => useRamadan('m1'));
    await waitFor(() => {
      expect(result.current.ramadan.data).toEqual(off);
    });
    await act(() => result.current.save.mutateAsync(on));
    expect(masjidApi.saveRamadan).toHaveBeenCalledWith('m1', on);
    expect(client.getQueryData(masjidKeys.ramadan('m1'))).toEqual(on);
    await waitFor(() => {
      expect(result.current.ramadan.data).toEqual(on);
    });
  });
});
