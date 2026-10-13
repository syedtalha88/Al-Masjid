import { describe, expect, it, vi } from 'vitest';

import { ManualClock, ShiftableClock, systemClock } from './clock.ts';

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

describe('ShiftableClock', () => {
  it('follows its source until moved, then keeps flowing from the new instant', () => {
    let real = Date.parse('2026-10-13T10:00:00Z');
    const clock = new ShiftableClock(() => real);
    expect(clock.now().toISOString()).toBe('2026-10-13T10:00:00.000Z');
    clock.set(new Date('2026-10-20T00:00:00Z'));
    real += 5_000;
    expect(clock.now().toISOString()).toBe('2026-10-20T00:00:05.000Z');
    clock.advance(24 * 60 * 60_000);
    expect(clock.now().toISOString()).toBe('2026-10-21T00:00:05.000Z');
    clock.reset();
    expect(clock.now().toISOString()).toBe('2026-10-13T10:00:05.000Z');
  });

  it('defaults to Date.now and rejects invalid input', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-26T03:30:00Z'));
    const clock = new ShiftableClock();
    expect(clock.now().toISOString()).toBe('2026-09-26T03:30:00.000Z');
    vi.useRealTimers();
    expect(() => {
      clock.set(new Date('nope'));
    }).toThrow(RangeError);
    expect(() => {
      clock.advance(Number.POSITIVE_INFINITY);
    }).toThrow(RangeError);
  });
});
