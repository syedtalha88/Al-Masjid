import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  CHANDA_CHART_WEEKS,
  chandaWeekEnd,
  chandaWeekOf,
  isChandaWeekStart,
  recentChandaWeeks,
} from '../src/chanda.ts';
import { addDays, daysInMonth, toCalendarDate, weekdayOf } from '../src/time.ts';

// Weekly chanda weeks (00 §4.3, PHASE_05 T5.5): a masjid's week starts on Friday by default (or Monday — 1 = Mon …
// 7 = Sun, 02 masjids.chanda_week_start); every date belongs to exactly one week.

const FRIDAY = 5;
const MONDAY = 1;

describe('chandaWeekOf', () => {
  it('is the latest week-start day on or before the date', () => {
    // 2026-11-13 is a Friday.
    expect(chandaWeekOf('2026-11-13', FRIDAY)).toBe('2026-11-13');
    expect(chandaWeekOf('2026-11-19', FRIDAY)).toBe('2026-11-13'); // Thursday
    expect(chandaWeekOf('2026-11-12', FRIDAY)).toBe('2026-11-06');
    expect(chandaWeekOf('2026-11-16', MONDAY)).toBe('2026-11-16');
    expect(chandaWeekOf('2026-11-15', MONDAY)).toBe('2026-11-09'); // Sunday
    expect(chandaWeekOf('2027-01-01', 7)).toBe('2026-12-27'); // Sunday weeks across a year end
  });

  it('refuses a week start outside 1–7', () => {
    expect(() => chandaWeekOf('2026-11-13', 0)).toThrow(RangeError);
    expect(() => chandaWeekOf('2026-11-13', 8)).toThrow(RangeError);
  });

  it('every date lies in the 7 days of its week, which starts on the right weekday', () => {
    const date = fc
      .record({ year: fc.integer({ min: 2000, max: 2100 }), month: fc.integer({ min: 1, max: 12 }), day: fc.nat() })
      .map(({ year, month, day }) => toCalendarDate(year, month, (day % daysInMonth(year, month)) + 1));
    fc.assert(
      fc.property(date, fc.integer({ min: 1, max: 7 }), (value, start) => {
        const week = chandaWeekOf(value, start);
        expect(isChandaWeekStart(week, start)).toBe(true);
        expect(weekdayOf(week) === 0 ? 7 : weekdayOf(week)).toBe(start);
        expect(week <= value && value <= chandaWeekEnd(week)).toBe(true);
      }),
    );
  });
});

describe('isChandaWeekStart / chandaWeekEnd', () => {
  it('checks the weekday; the week ends 6 days later', () => {
    expect(isChandaWeekStart('2026-11-13', FRIDAY)).toBe(true);
    expect(isChandaWeekStart('2026-11-14', FRIDAY)).toBe(false);
    expect(isChandaWeekStart('not a date', FRIDAY)).toBe(false);
    expect(chandaWeekEnd('2026-11-13')).toBe('2026-11-19');
  });
});

describe('recentChandaWeeks', () => {
  it('the last 8 week starts up to this week, oldest first', () => {
    const weeks = recentChandaWeeks('2026-11-19', FRIDAY);
    expect(weeks).toHaveLength(CHANDA_CHART_WEEKS);
    expect(weeks.at(-1)).toBe('2026-11-13');
    expect(weeks[0]).toBe(addDays('2026-11-13', -7 * 7));
    expect(recentChandaWeeks('2026-11-19', FRIDAY, 3)).toEqual(['2026-10-30', '2026-11-06', '2026-11-13']);
  });
});
