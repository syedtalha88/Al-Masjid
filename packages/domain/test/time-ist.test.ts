import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  addMinutesClamped,
  CLOCK_DRIFT_THRESHOLD_MS,
  correctedNow,
  effectiveClockOffset,
  fromMinutesOfDay,
  istInstant,
  minutesOfDay,
  msUntilNextIstMidnight,
  msUntilNextMinute,
  serverClockOffset,
  wallClockInZone,
} from '../src/time.ts';

// T2.1 `time`: IST wall-clock helpers, midnight rollover, server drift correction from the `Date` header (00 §7).

describe('minutes of the day', () => {
  it('converts both ways', () => {
    expect(minutesOfDay('00:00')).toBe(0);
    expect(minutesOfDay('05:15')).toBe(315);
    expect(minutesOfDay('23:59')).toBe(1439);
    expect(fromMinutesOfDay(0)).toBe('00:00');
    expect(fromMinutesOfDay(1439)).toBe('23:59');
    expect(() => minutesOfDay('24:00')).toThrow(RangeError);
    expect(() => fromMinutesOfDay(1440)).toThrow(RangeError);
    expect(() => fromMinutesOfDay(-1)).toThrow(RangeError);
    expect(() => fromMinutesOfDay(1.5)).toThrow(RangeError);
  });

  it('round-trips every minute (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1439 }), (minute) => minutesOfDay(fromMinutesOfDay(minute)) === minute),
    );
  });

  it('adds minutes without crossing midnight (an Isha jamaat is at most 23:59 — 00 §4.2)', () => {
    expect(addMinutesClamped('18:32', 8)).toBe('18:40');
    expect(addMinutesClamped('23:50', 15)).toBe('23:59');
    expect(addMinutesClamped('00:05', -10)).toBe('00:00');
    expect(addMinutesClamped('12:00', 0)).toBe('12:00');
  });
});

describe('istInstant', () => {
  it('is the instant of an IST wall-clock time (UTC+05:30, no daylight saving)', () => {
    expect(istInstant('2026-10-22', '05:30').toISOString()).toBe('2026-10-22T00:00:00.000Z');
    expect(istInstant('2026-10-22', '00:00').toISOString()).toBe('2026-10-21T18:30:00.000Z');
    expect(istInstant('2026-12-31', '23:59').toISOString()).toBe('2026-12-31T18:29:00.000Z');
  });

  it('agrees with the Intl-based IST clock (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1439 }), (minute) => {
        const hhmm = fromMinutesOfDay(minute);
        return wallClockInZone(istInstant('2026-03-20', hhmm)) === hhmm;
      }),
    );
  });

  it('refuses malformed dates and times', () => {
    expect(() => istInstant('2026-02-30', '05:30')).toThrow(RangeError);
    expect(() => istInstant('2026-02-28', '5:30')).toThrow(RangeError);
  });
});

describe('rollover timers', () => {
  it('waits until the next whole minute (countdowns re-render on minute boundaries — 08 §5.5)', () => {
    expect(msUntilNextMinute(new Date(Date.UTC(2026, 9, 22, 6, 0, 0, 0)))).toBe(60_000);
    expect(msUntilNextMinute(new Date(Date.UTC(2026, 9, 22, 6, 0, 59, 500)))).toBe(500);
    expect(msUntilNextMinute(new Date(Date.UTC(2026, 9, 22, 6, 0, 1, 0)))).toBe(59_000);
  });

  it('waits until the next midnight in India, not on the device', () => {
    // 22 Oct 23:59:30 IST = 18:29:30 UTC → 30 s to go.
    expect(msUntilNextIstMidnight(new Date(Date.UTC(2026, 9, 22, 18, 29, 30)))).toBe(30_000);
    // Exactly midnight IST → a full day.
    expect(msUntilNextIstMidnight(new Date(Date.UTC(2026, 9, 22, 18, 30)))).toBe(86_400_000);
    // 05:30 IST → 18.5 h.
    expect(msUntilNextIstMidnight(new Date(Date.UTC(2026, 9, 22, 0, 0)))).toBe(18.5 * 3_600_000);
  });
});

describe('server clock drift (00 §7)', () => {
  const sentAt = Date.UTC(2026, 9, 22, 6, 0, 0);

  it('measures the offset against the middle of the request', () => {
    // Server says 06:10:00 (+0.5 s for the truncated second); the request took 1 s → device midpoint 06:00:00.5.
    const offset = serverClockOffset('Thu, 22 Oct 2026 06:10:00 GMT', sentAt, sentAt + 1000);
    expect(offset).toBe(600_000);
    expect(serverClockOffset('Thu, 22 Oct 2026 05:50:00 GMT', sentAt, sentAt)).toBe(-599_500);
  });

  it('ignores missing, malformed or unreliable measurements', () => {
    expect(serverClockOffset(null, sentAt, sentAt)).toBeNull();
    expect(serverClockOffset(undefined, sentAt, sentAt)).toBeNull();
    expect(serverClockOffset('yesterday', sentAt, sentAt)).toBeNull();
    expect(serverClockOffset('Thu, 22 Oct 2026 06:10:00 +0530', sentAt, sentAt)).toBeNull();
    expect(serverClockOffset('Thu, 32 Oct 2026 06:10:00 GMT', sentAt, sentAt)).toBeNull();
    expect(serverClockOffset('Thu, 22 Oct 2026 06:10:00 GMT', sentAt, sentAt - 1)).toBeNull(); // time went backwards
    expect(serverClockOffset('Thu, 22 Oct 2026 06:10:00 GMT', sentAt, sentAt + 31_000)).toBeNull(); // too slow to trust
  });

  it('corrects only a drift above 2 minutes', () => {
    expect(CLOCK_DRIFT_THRESHOLD_MS).toBe(120_000);
    expect(effectiveClockOffset(null)).toBe(0);
    expect(effectiveClockOffset(120_000)).toBe(0);
    expect(effectiveClockOffset(-90_000)).toBe(0);
    expect(effectiveClockOffset(120_001)).toBe(120_001);
    expect(effectiveClockOffset(-600_000)).toBe(-600_000);
    expect(correctedNow(sentAt, 600_000).getTime()).toBe(sentAt + 600_000);
    expect(correctedNow(sentAt, 60_000).getTime()).toBe(sentAt);
  });
});
