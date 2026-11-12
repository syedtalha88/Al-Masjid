// Weekly chanda weeks (00 §4.3, 02 masjids.chanda_week_start, PHASE_05 T5.5): each masjid's week starts on its chosen
// day (1 = Monday … 7 = Sunday; Friday by default); a week is named by its first day ("YYYY-MM-DD"). Pure.
import { addDays, isCalendarDate, weekdayOf } from './time.ts';

/** A11: the chart shows the last 8 weeks. */
export const CHANDA_CHART_WEEKS = 8;

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
const isoWeekday = (date: string): number => {
  const day = weekdayOf(date);
  return day === 0 ? 7 : day;
};

function checkStart(weekStart: number): void {
  if (!Number.isInteger(weekStart) || weekStart < 1 || weekStart > 7) {
    throw new RangeError('chanda week start must be 1 (Monday) … 7 (Sunday)');
  }
}

/**
 * The week a date belongs to: the latest `weekStart` weekday on or before `date`.
 *
 * @param weekStart - 1 = Monday … 7 = Sunday (5 = Friday, the default).
 * @throws RangeError for an invalid date or week start.
 */
export function chandaWeekOf(date: string, weekStart: number): string {
  checkStart(weekStart);
  return addDays(date, -((isoWeekday(date) - weekStart + 7) % 7));
}

/** Whether `date` is a valid calendar date that falls on the masjid's week-start day. Never throws. */
export function isChandaWeekStart(date: string, weekStart: number): boolean {
  if (!isCalendarDate(date) || !Number.isInteger(weekStart) || weekStart < 1 || weekStart > 7) return false;
  return isoWeekday(date) === weekStart;
}

/** The last day of the week that starts on `weekStartDate` (6 days later). */
export const chandaWeekEnd = (weekStartDate: string): string => addDays(weekStartDate, 6);

/**
 * The `count` most recent week starts up to the week of `today`, oldest first (the chart's x axis).
 *
 * @throws RangeError for an invalid date or week start.
 */
export function recentChandaWeeks(today: string, weekStart: number, count = CHANDA_CHART_WEEKS): string[] {
  const current = chandaWeekOf(today, weekStart);
  return Array.from({ length: count }, (_, index) => addDays(current, -7 * (count - 1 - index)));
}
