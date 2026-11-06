// @vitest-environment jsdom
// 07 B4 (T3.2, PROGRESS F50): the editor's state — the draft starts from the loaded schedule, a save goes out at the
// revision the draft started from (412 when someone saved in between → "conflict"), a successful save moves the base
// to the new revision and refreshes the masjid's queries, and reload() starts again from the latest save.
import type { AdminSchedule } from '@mc/shared/contracts';
import { ProblemError } from '@mc/shared/http';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as MasjidApi from '../../home/api/masjid-api.ts';
import { masjidApi, masjidKeys } from '../../home/api/masjid-api.ts';
import { useTimingsEditor } from '../hooks/use-timings-editor.ts';
import { saveBody } from '../lib/editor.ts';

vi.mock('../../home/api/masjid-api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof MasjidApi>()),
  masjidApi: { schedule: vi.fn(), saveTimings: vi.fn() },
}));

const MASJID = {
  name: 'Test Masjid Alpha',
  lat: 17.385,
  lng: 78.4867,
  calcMethod: 'karachi',
  asrMadhab: 'hanafi',
} as const;
const offset = (jamaatOffsetMin: number) =>
  ({ adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'offset', jamaatOffsetMin }) as const;
const TIMINGS: NonNullable<AdminSchedule['timings']> = {
  prayers: { fajr: offset(20), dhuhr: offset(15), asr: offset(15), maghrib: offset(5), isha: offset(15) },
  jumuah: [{ seq: 1, jamaatTime: '13:30' }],
};
const SCHEDULE: AdminSchedule = { masjid: MASJID, timings: TIMINGS, rev: 3 };

const problem = (status: number, code: string) =>
  new ProblemError({ type: 'about:blank', title: code, status, code }, undefined);

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { invalidate, ...renderHook(() => useTimingsEditor('m1'), { wrapper }) };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('useTimingsEditor', () => {
  it('starts the draft from the loaded schedule; nothing loads without a masjid', async () => {
    vi.mocked(masjidApi.schedule).mockResolvedValue(SCHEDULE);
    const client = new QueryClient();
    const idle = renderHook(() => useTimingsEditor(undefined), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    expect(idle.result.current.draft).toBeNull();
    expect(masjidApi.schedule).not.toHaveBeenCalled();
    const { result } = setup();
    await waitFor(() => {
      expect(result.current.draft).toEqual(TIMINGS);
    });
    expect(result.current.saved).toEqual(TIMINGS);
    expect(result.current.masjid).toEqual(MASJID);
    expect(result.current.problem).toBeNull();
  });

  it('saves at the draft’s revision, then moves to the new one and refreshes the masjid’s queries', async () => {
    vi.mocked(masjidApi.schedule).mockResolvedValue(SCHEDULE);
    vi.mocked(masjidApi.saveTimings).mockResolvedValueOnce({ rev: 4, item: null });
    vi.mocked(masjidApi.saveTimings).mockResolvedValueOnce({ rev: 5, item: { publicId: 'p1' } });
    const { result, invalidate } = setup();
    await waitFor(() => {
      expect(result.current.draft).not.toBeNull();
    });
    const edited = { ...TIMINGS, prayers: { ...TIMINGS.prayers, maghrib: offset(10) } };
    act(() => {
      result.current.setDraft(edited);
    });
    await act(() => result.current.save.mutateAsync({ notify: false }));
    expect(masjidApi.saveTimings).toHaveBeenLastCalledWith('m1', 3, saveBody(edited, false));
    expect(result.current.saved).toEqual(edited);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: masjidKeys.all('m1') });
    // The next save goes out at the stored revision, with "Notify followers" as chosen.
    await act(() => result.current.save.mutateAsync({ notify: true }));
    expect(masjidApi.saveTimings).toHaveBeenLastCalledWith('m1', 4, saveBody(edited, true));
  });

  it('someone saved in between (412) → "conflict"; reload() drops the draft and starts from the latest save', async () => {
    vi.mocked(masjidApi.schedule).mockResolvedValueOnce(SCHEDULE);
    const theirs = { ...TIMINGS, prayers: { ...TIMINGS.prayers, fajr: offset(30) } };
    vi.mocked(masjidApi.schedule).mockResolvedValueOnce({ ...SCHEDULE, timings: theirs, rev: 7 });
    vi.mocked(masjidApi.saveTimings).mockRejectedValueOnce(problem(412, 'PRECONDITION_FAILED'));
    const { result } = setup();
    await waitFor(() => {
      expect(result.current.draft).not.toBeNull();
    });
    act(() => {
      result.current.setDraft({ ...TIMINGS, jumuah: [] });
    });
    await act(async () => {
      await result.current.save.mutateAsync({ notify: false }).catch(() => undefined);
    });
    await waitFor(() => {
      expect(result.current.problem).toBe('conflict');
    });
    await act(() => result.current.reload());
    expect(result.current.problem).toBeNull();
    expect(result.current.draft).toEqual(theirs);
    expect(result.current.saved).toEqual(theirs);
  });

  it('the day’s notifications are used up → "quota"; anything else → "other"', async () => {
    vi.mocked(masjidApi.schedule).mockResolvedValue(SCHEDULE);
    vi.mocked(masjidApi.saveTimings).mockRejectedValueOnce(problem(409, 'NOTIFY_QUOTA_EXCEEDED'));
    vi.mocked(masjidApi.saveTimings).mockRejectedValueOnce(new Error('offline'));
    const { result } = setup();
    await waitFor(() => {
      expect(result.current.draft).not.toBeNull();
    });
    await act(async () => {
      await result.current.save.mutateAsync({ notify: true }).catch(() => undefined);
    });
    await waitFor(() => {
      expect(result.current.problem).toBe('quota');
    });
    await act(async () => {
      await result.current.save.mutateAsync({ notify: false }).catch(() => undefined);
    });
    await waitFor(() => {
      expect(result.current.problem).toBe('other');
    });
  });
});
