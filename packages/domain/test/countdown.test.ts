import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { countdown, COUNTDOWN_SOON_MINUTES } from '../src/countdown.ts';

// 07 A2: "2h 18m left", "48m left"; under 10 min → "Starts in 8 min"; at the time → "Jamaat now" for 10 min.
// Minutes are rounded up so the label reads "at most N minutes to go" between minute-aligned re-renders.

const target = new Date(Date.UTC(2026, 9, 22, 8, 15)); // 13:45 IST
const before = (ms: number) => new Date(target.getTime() - ms);
const MIN = 60_000;

describe('countdown', () => {
  it('shows hours and minutes, then minutes', () => {
    expect(countdown(target, before(138 * MIN))).toEqual({ kind: 'left', hours: 2, minutes: 18 });
    expect(countdown(target, before(137.5 * MIN))).toEqual({ kind: 'left', hours: 2, minutes: 18 });
    expect(countdown(target, before(120 * MIN))).toEqual({ kind: 'left', hours: 2, minutes: 0 });
    expect(countdown(target, before(48 * MIN))).toEqual({ kind: 'left', hours: 0, minutes: 48 });
    expect(countdown(target, before(10 * MIN))).toEqual({ kind: 'left', hours: 0, minutes: 10 });
  });

  it('switches to "Starts in N min" under 10 minutes', () => {
    expect(COUNTDOWN_SOON_MINUTES).toBe(10);
    expect(countdown(target, before(9 * MIN))).toEqual({ kind: 'soon', minutes: 9 });
    expect(countdown(target, before(8 * MIN + 1))).toEqual({ kind: 'soon', minutes: 9 });
    expect(countdown(target, before(1))).toEqual({ kind: 'soon', minutes: 1 });
  });

  it('reads "Jamaat now" for 10 minutes from the start, then past', () => {
    expect(countdown(target, target)).toEqual({ kind: 'now' });
    expect(countdown(target, before(-10 * MIN + 1))).toEqual({ kind: 'now' });
    expect(countdown(target, before(-10 * MIN))).toEqual({ kind: 'past' });
  });

  it('never shows more minutes than are left, nor a value off by more than one (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 48 * 3600 * 1000 }), (ms) => {
        const state = countdown(target, before(ms));
        const shown =
          state.kind === 'left' ? state.hours * 60 + state.minutes : state.kind === 'soon' ? state.minutes : -1;
        return shown * MIN >= ms && (shown - 1) * MIN < ms && (state.kind !== 'left' || state.minutes < 60);
      }),
    );
  });
});
