// @vitest-environment jsdom
import { ADHKAR_MAX, adhkarPutSchema, type AdminLibraryEntry } from '@mc/shared/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as MasjidApi from '../../home/api/masjid-api.ts';
import { masjidApi, masjidKeys } from '../../home/api/masjid-api.ts';
import { useAdhkar, useSaveAdhkar } from '../hooks/use-adhkar.ts';
import { addDhikr, adhkarBody, adhkarChanged, moveDhikr, removeDhikr } from '../lib/adhkar.ts';

// 07 B16 (PHASE_03 T3.14): adding (not twice, at most 30), moving and removing dhikr, "changed?", the PUT body (passes
// the server contract), and the hooks (the saved set replaces the cache). Fake texts only (10 §Fixtures).

vi.mock('../../home/api/masjid-api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof MasjidApi>()),
  masjidApi: { adhkar: vi.fn(), saveAdhkar: vi.fn() },
}));

afterEach(() => {
  vi.resetAllMocks();
});

const dhikr = (index: number): AdminLibraryEntry => ({
  id: `0b7f6c2e-1d4a-4f3b-9c8e-${String(index).padStart(12, '0')}`,
  kind: 'dhikr',
  arabic: 'نَصٌّ تجريبي للعرض فقط',
  transliteration: {},
  translation: { en: 'Sample translation text for development.' },
  reference: `DEV-SAMPLE-${String(index).padStart(3, '0')}`,
  sourceName: 'Development fixture',
  sourceLicense: 'N/A — not for production',
  tags: [],
  repeat: 33,
});
const [A, B, C] = [dhikr(1), dhikr(2), dhikr(3)];

describe('adhkar edits', () => {
  it('adds at the end, never twice, never past 30', () => {
    const edit = addDhikr(addDhikr({ enabled: true, entries: [] }, A), B);
    expect(edit.entries.map((entry) => entry.id)).toEqual([A.id, B.id]);
    expect(addDhikr(edit, A)).toBe(edit);
    const full = { enabled: true, entries: Array.from({ length: ADHKAR_MAX }, (_, index) => dhikr(index + 10)) };
    expect(addDhikr(full, C)).toBe(full);
  });

  it('moves and removes; out-of-range moves change nothing', () => {
    const edit = { enabled: true, entries: [A, B, C] };
    expect(moveDhikr(edit, 2, 0).entries.map((entry) => entry.id)).toEqual([C.id, A.id, B.id]);
    expect(moveDhikr(edit, 0, 1).entries.map((entry) => entry.id)).toEqual([B.id, A.id, C.id]);
    expect(moveDhikr(edit, 0, -1)).toBe(edit);
    expect(moveDhikr(edit, 2, 3)).toBe(edit);
    expect(removeDhikr(edit, B.id).entries.map((entry) => entry.id)).toEqual([A.id, C.id]);
  });

  it('knows when it differs from the saved set; the body passes the server contract', () => {
    const saved = { enabled: true, entries: [A, B] };
    expect(adhkarChanged({ enabled: true, entries: [A, B] }, saved)).toBe(false);
    expect(adhkarChanged({ enabled: false, entries: [A, B] }, saved)).toBe(true);
    expect(adhkarChanged({ enabled: true, entries: [B, A] }, saved)).toBe(true);
    expect(adhkarChanged({ enabled: true, entries: [A] }, saved)).toBe(true);
    const body = adhkarBody({ enabled: true, entries: [B, A] });
    expect(body).toEqual({ enabled: true, libraryIds: [B.id, A.id] });
    expect(adhkarPutSchema.safeParse(body).success).toBe(true);
    expect(adhkarPutSchema.safeParse({ enabled: true, libraryIds: [A.id, A.id] }).success).toBe(false);
  });
});

describe('useAdhkar / useSaveAdhkar', () => {
  it('loads the set; a save puts the answer in the cache', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    vi.mocked(masjidApi.adhkar).mockResolvedValue({ enabled: false, entries: [] });
    vi.mocked(masjidApi.saveAdhkar).mockResolvedValue({ enabled: true, entries: [A] });
    const { result } = renderHook(() => ({ set: useAdhkar('m1'), save: useSaveAdhkar('m1') }), { wrapper });
    await waitFor(() => {
      expect(result.current.set.data).toEqual({ enabled: false, entries: [] });
    });
    await act(() => result.current.save.mutateAsync({ enabled: true, libraryIds: [A.id] }));
    expect(masjidApi.saveAdhkar).toHaveBeenCalledWith('m1', { enabled: true, libraryIds: [A.id] });
    expect(client.getQueryData(masjidKeys.adhkar('m1'))).toEqual({ enabled: true, entries: [A] });
    const idle = renderHook(() => useAdhkar(undefined), { wrapper });
    expect(idle.result.current.fetchStatus).toBe('idle');
  });
});
