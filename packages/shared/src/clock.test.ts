import { describe, expect, it, vi } from 'vitest';

import { ManualClock, systemClock } from './clock.ts';

describe('Clock', () => {
  it('systemClock follows the real (here: faked) time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-26T03:30:00Z'));
    expect(systemClock.now().toISOString()).toBe('2026-09-26T03:30:00.000Z');
    vi.useRealTimers();
  });

  it('ManualClock moves only when told to and hands out copies', () => {
    const clock = new ManualClock(new Date('2026-09-26T00:00:00Z'));
    const first = clock.now();
    first.setUTCFullYear(2000);
    expect(clock.now().toISOString()).toBe('2026-09-26T00:00:00.000Z');
    clock.advance(90 * 60_000);
    expect(clock.now().toISOString()).toBe('2026-09-26T01:30:00.000Z');
    clock.set(new Date('2027-01-01T00:00:00Z'));
    expect(clock.now().getUTCFullYear()).toBe(2027);
    clock.advance(-1);
    expect(clock.now().toISOString()).toBe('2026-12-31T23:59:59.999Z');
  });

  it('rejects invalid times', () => {
    expect(() => new ManualClock(new Date('nope'))).toThrow(RangeError);
    const clock = new ManualClock(new Date(0));
    expect(() => {
      clock.advance(Number.NaN);
    }).toThrow(RangeError);
    expect(() => {
      clock.set(new Date(Number.NaN));
    }).toThrow(RangeError);
  });
});
