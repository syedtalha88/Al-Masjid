// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSelectedMasjid } from '../hooks/use-selected-masjid.ts';

const MASJIDS = [
  { id: 'm1', name: 'Test Masjid Alpha', role: 'owner' as const },
  { id: 'm2', name: 'Test Masjid Beta', role: 'editor' as const },
];

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

// 07 B3 masjid switcher: remembered per browser as a convenience; the list from /me always wins.
describe('useSelectedMasjid', () => {
  it('starts with the first masjid and remembers a choice', () => {
    const first = renderHook(() => useSelectedMasjid(MASJIDS));
    expect(first.result.current.masjid?.id).toBe('m1');
    act(() => {
      first.result.current.select('m2');
    });
    expect(first.result.current.masjid?.id).toBe('m2');
    expect(renderHook(() => useSelectedMasjid(MASJIDS)).result.current.masjid?.id).toBe('m2');
  });

  it('a remembered masjid the admin no longer has falls back to the first; none at all → undefined', () => {
    window.localStorage.setItem('mc.admin.masjid', 'gone');
    expect(renderHook(() => useSelectedMasjid(MASJIDS)).result.current.masjid?.id).toBe('m1');
    expect(renderHook(() => useSelectedMasjid([])).result.current.masjid).toBeUndefined();
  });

  it('blocked storage: still works, just not remembered', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useSelectedMasjid(MASJIDS));
    expect(result.current.masjid?.id).toBe('m1');
    act(() => {
      result.current.select('m2');
    });
    expect(result.current.masjid?.id).toBe('m2');
  });
});
