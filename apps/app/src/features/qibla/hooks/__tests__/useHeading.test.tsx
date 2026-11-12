// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NO_COMPASS_MS } from '../../lib/heading.ts';
import { useHeading } from '../useHeading.ts';

// PHASE_07 T7.2 / 08 §5.9 — the hook around the heading stream: live on the first reading, "no compass" after 2 s of
// silence, one vibration per entry into the ±3° zone (at most every 1.5 s), and no listening while the page is hidden.

const BEARING = 280;

/** One absolute reading for `heading` (Chromium: alpha counter-clockwise). */
const reading = (heading: number) => {
  const event = new Event('deviceorientationabsolute');
  Object.assign(event, { alpha: (360 - heading) % 360, beta: 0, gamma: 0, absolute: true });
  window.dispatchEvent(event);
};

/** Enough readings for the smoothed value to settle on `heading`. */
const settleAt = (heading: number) => {
  act(() => {
    for (let n = 0; n < 80; n += 1) reading(heading);
  });
};

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

let vibrate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-11-13T06:00:00Z'));
  vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setHidden(false);
});

describe('useHeading', () => {
  it('turns live on the first reading and follows the stream', () => {
    const { result } = renderHook(() => useHeading(BEARING));
    expect(result.current.status).toBe('waiting');
    settleAt(100);
    expect(result.current.status).toBe('live');
    expect(result.current.heading.get()).toBeCloseTo(100, 0);
    expect(result.current.aligned).toBe(false);
  });

  it('says "no compass" when nothing arrives within 2 s', () => {
    const { result } = renderHook(() => useHeading(BEARING));
    act(() => {
      vi.advanceTimersByTime(NO_COMPASS_MS + 10);
    });
    expect(result.current.status).toBe('none');
  });

  it('vibrates once per entry into the aligned zone, at most every 1.5 s', () => {
    const { result } = renderHook(() => useHeading(BEARING));
    settleAt(BEARING - 30);
    settleAt(BEARING + 1);
    expect(result.current.aligned).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(1);

    // Staying in the zone: nothing more. Out and straight back in (< 1.5 s): still one.
    settleAt(BEARING - 1);
    settleAt(BEARING + 30);
    expect(result.current.aligned).toBe(false);
    settleAt(BEARING);
    expect(result.current.aligned).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(1);

    // After the debounce, a new entry vibrates again.
    settleAt(BEARING + 30);
    vi.setSystemTime(Date.now() + 1600);
    settleAt(BEARING);
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('stops listening while the page is hidden and starts again when it comes back', () => {
    const { result } = renderHook(() => useHeading(BEARING));
    settleAt(100);
    setHidden(true);
    settleAt(200);
    expect(result.current.heading.get()).toBeCloseTo(100, 0);
    setHidden(false);
    settleAt(200);
    expect(result.current.heading.get()).toBeCloseTo(200, 0);
  });

  it('removes its listeners when the page is left', () => {
    const { result, unmount } = renderHook(() => useHeading(BEARING));
    settleAt(100);
    const heading = result.current.heading;
    unmount();
    settleAt(200);
    expect(heading.get()).toBeCloseTo(100, 0);
  });
});
