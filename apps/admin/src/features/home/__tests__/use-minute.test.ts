// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMinute } from '../hooks/use-minute.ts';

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-28T10:00:30.000Z'));
});
afterEach(() => {
  setVisibility('visible');
  vi.useRealTimers();
});

// 07 B3 today strip: the clock ticks once per minute boundary and catches up when the page comes back.
describe('useMinute', () => {
  it('keeps one Date until the next minute boundary, then ticks every minute', () => {
    const { result } = renderHook(() => useMinute());
    const first = result.current;
    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(result.current).toBe(first);
    act(() => {
      vi.advanceTimersByTime(1_005);
    });
    expect(result.current.toISOString()).toBe('2026-10-28T10:01:00.005Z');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.getUTCMinutes()).toBe(2);
  });

  it('stops while hidden and refreshes at once when visible again', () => {
    const { result } = renderHook(() => useMinute());
    const first = result.current;
    act(() => {
      setVisibility('hidden');
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(result.current).toBe(first);
    act(() => {
      setVisibility('visible');
    });
    expect(result.current.toISOString()).toBe('2026-10-28T10:05:30.000Z');
  });

  it('cleans up its timer and listener on unmount', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useMinute());
    unmount();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
