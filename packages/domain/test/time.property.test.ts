import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  compareCalendarDates,
  daysInMonth,
  isCalendarDate,
  monthGrid,
  toCalendarDate,
  weekdayOf,
} from '../src/time.ts';

// Property-based tests (10 §1): calendar arithmetic holds for every date 1900–2100, not just the examples.
const date = fc
  .record({ year: fc.integer({ min: 1900, max: 2100 }), month: fc.integer({ min: 1, max: 12 }), day: fc.nat() })
  .map(({ year, month, day }) => toCalendarDate(year, month, (day % daysInMonth(year, month)) + 1));
const offset = fc.integer({ min: -3650, max: 3650 });

describe('calendar properties', () => {
  it('addDays always yields a valid date and is reversible', () => {
    fc.assert(
      fc.property(date, offset, (start, days) => {
        const moved = addDays(start, days);
        expect(isCalendarDate(moved)).toBe(true);
        expect(addDays(moved, -days)).toBe(start);
      }),
    );
  });

  it('addDays moves in the direction of its sign and composes', () => {
    fc.assert(
      fc.property(date, offset, offset, (start, a, b) => {
        expect(Math.sign(compareCalendarDates(addDays(start, a), start))).toBe(Math.sign(a));
        expect(addDays(addDays(start, a), b)).toBe(addDays(start, a + b));
      }),
    );
  });

  it('weekdays advance by one per day', () => {
    fc.assert(
      fc.property(date, offset, (start, days) => {
        expect(weekdayOf(addDays(start, days))).toBe((((weekdayOf(start) + days) % 7) + 7) % 7);
      }),
    );
  });

  it('addMonths lands in the right month and never overflows into the next', () => {
    fc.assert(
      fc.property(date, fc.integer({ min: -240, max: 240 }), (start, months) => {
        const moved = addMonths(start, months);
        expect(isCalendarDate(moved)).toBe(true);
        const [y1, m1] = start.split('-').map(Number);
        const [y2, m2] = moved.split('-').map(Number);
        expect((y2 ?? 0) * 12 + (m2 ?? 0) - ((y1 ?? 0) * 12 + (m1 ?? 0))).toBe(months);
      }),
    );
  });

  it('a month grid holds every day of the month once, in order, starting on the right weekday', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1900, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 6 }),
        (year, month, weekStart) => {
          const cells = monthGrid(year, month, weekStart);
          const days = cells.filter((cell): cell is string => cell !== null);
          expect(days).toHaveLength(daysInMonth(year, month));
          expect([...days].sort()).toEqual(days);
          const first = cells.findIndex((cell) => cell !== null);
          expect((first + weekStart) % 7).toBe(weekdayOf(toCalendarDate(year, month, 1)));
        },
      ),
    );
  });
});
