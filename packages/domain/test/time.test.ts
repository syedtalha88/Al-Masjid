import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  calendarDateInZone,
  compareCalendarDates,
  daysInMonth,
  from12Hour,
  isCalendarDate,
  isWallClock,
  monthGrid,
  parseCalendarDate,
  parseWallClock,
  to12Hour,
  toCalendarDate,
  toWallClock,
  wallClockInZone,
  weekdayOf,
} from '../src/time.ts';

// CLAUDE.md §6 Time: calendar dates are "YYYY-MM-DD" strings, wall-clock times "HH:mm"; displayed in IST.

describe('calendar dates', () => {
  it('validates real dates only', () => {
    expect(isCalendarDate('2026-09-26')).toBe(true);
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-9-26')).toBe(false);
    expect(isCalendarDate(' 2026-09-26')).toBe(false);
    expect(isCalendarDate(20260926)).toBe(false);
  });

  it('parses and builds', () => {
    expect(parseCalendarDate('2026-09-26')).toEqual({ year: 2026, month: 9, day: 26 });
    expect(toCalendarDate(2026, 1, 5)).toBe('2026-01-05');
    expect(() => parseCalendarDate('2026-02-30')).toThrow(RangeError);
    expect(() => toCalendarDate(2026, 2, 30)).toThrow(RangeError);
  });

  it('days in month incl. leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-09-26', 0)).toBe('2026-09-26');
    expect(addDays('2026-09-26', 400)).toBe('2027-10-31');
  });

  it('adds months clamping the day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(addMonths('2026-03-31', -13)).toBe('2025-02-28');
  });

  it('compares and finds weekdays (0 = Sunday)', () => {
    expect(compareCalendarDates('2026-09-26', '2026-10-01')).toBeLessThan(0);
    expect(compareCalendarDates('2026-09-26', '2026-09-26')).toBe(0);
    expect(weekdayOf('2026-09-26')).toBe(6);
    expect(weekdayOf('2026-10-04')).toBe(0);
  });

  it('month grid: 42 cells, blanks around the month, any week start', () => {
    const sundayFirst = monthGrid(2026, 9, 0);
    expect(sundayFirst).toHaveLength(42);
    // 1 Sep 2026 is a Tuesday → two blanks first.
    expect(sundayFirst.slice(0, 3)).toEqual([null, null, '2026-09-01']);
    expect(sundayFirst.filter(Boolean)).toHaveLength(30);
    expect(sundayFirst[31]).toBe('2026-09-30');
    const mondayFirst = monthGrid(2026, 9, 1);
    expect(mondayFirst.slice(0, 2)).toEqual([null, '2026-09-01']);
  });

  it("today's date in IST, not UTC", () => {
    // 20:00 UTC on 25 Sep = 01:30 IST on 26 Sep.
    expect(calendarDateInZone(new Date(Date.UTC(2026, 8, 25, 20, 0)))).toBe('2026-09-26');
    expect(calendarDateInZone(new Date(Date.UTC(2026, 8, 25, 18, 0)))).toBe('2026-09-25');
    expect(wallClockInZone(new Date(Date.UTC(2026, 9, 22, 1, 33)))).toBe('07:03');
    expect(wallClockInZone(new Date(Date.UTC(2026, 9, 21, 18, 30)))).toBe('00:00'); // midnight is 00, not 24
  });
});

describe('wall-clock times', () => {
  it('validates, parses and builds "HH:mm"', () => {
    expect(isWallClock('05:15')).toBe(true);
    expect(isWallClock('23:59')).toBe(true);
    expect(isWallClock('24:00')).toBe(false);
    expect(isWallClock('5:15')).toBe(false);
    expect(parseWallClock('18:40')).toEqual({ hour: 18, minute: 40 });
    expect(toWallClock(5, 5)).toBe('05:05');
    expect(() => toWallClock(24, 0)).toThrow(RangeError);
    expect(() => parseWallClock('7pm')).toThrow(RangeError);
  });

  it('converts between 24-hour and 12-hour clocks', () => {
    expect(to12Hour(0)).toEqual({ hour12: 12, pm: false });
    expect(to12Hour(12)).toEqual({ hour12: 12, pm: true });
    expect(to12Hour(13)).toEqual({ hour12: 1, pm: true });
    expect(from12Hour(12, false)).toBe(0);
    expect(from12Hour(12, true)).toBe(12);
    expect(from12Hour(8, true)).toBe(20);
    for (let hour = 0; hour < 24; hour += 1) {
      const { hour12, pm } = to12Hour(hour);
      expect(from12Hour(hour12, pm)).toBe(hour);
    }
    expect(() => from12Hour(13, false)).toThrow(RangeError);
  });
});
