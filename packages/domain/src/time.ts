// Calendar dates ("YYYY-MM-DD") and wall-clock times ("HH:mm") — CLAUDE.md §6 Time. Pure: no I/O, no `Date.now()`.
// Calendar arithmetic runs in UTC so no device time zone or DST can shift a day.

/** India's display zone (01 §, 09 §4). */
export const DISPLAY_TIME_ZONE = 'Asia/Kolkata';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface CalendarParts {
  readonly year: number;
  /** 1–12. */
  readonly month: number;
  /** 1–31. */
  readonly day: number;
}

/**
 * Days in a Gregorian month.
 *
 * @param year - full year.
 * @param month - 1–12.
 */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Is `value` a real calendar date written exactly as "YYYY-MM-DD"?
 *
 * @returns false for anything else (wrong type, format, or a day that does not exist).
 */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/**
 * Splits a calendar date.
 *
 * @throws RangeError when `value` is not a valid "YYYY-MM-DD" date.
 */
export function parseCalendarDate(value: string): CalendarParts {
  const match = DATE_PATTERN.exec(value);
  if (!match || !isCalendarDate(value)) throw new RangeError('parseCalendarDate(): expected a valid "YYYY-MM-DD"');
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/**
 * Builds "YYYY-MM-DD".
 *
 * @throws RangeError for a day that does not exist.
 */
export function toCalendarDate(year: number, month: number, day: number): string {
  const text = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!isCalendarDate(text)) throw new RangeError('toCalendarDate(): no such date');
  return text;
}

const toUtc = (value: string) => {
  const { year, month, day } = parseCalendarDate(value);
  return Date.UTC(year, month - 1, day);
};

const fromUtc = (time: number) => {
  const date = new Date(time);
  return toCalendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
};

/**
 * `value` plus `days` (negative to go back).
 *
 * @throws RangeError when `value` is invalid.
 */
export function addDays(value: string, days: number): string {
  const date = new Date(toUtc(value));
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtc(date.getTime());
}

/**
 * `value` plus `months`; the day is clamped to the target month's length (31 Jan + 1 → 28/29 Feb).
 *
 * @throws RangeError when `value` is invalid.
 */
export function addMonths(value: string, months: number): string {
  const { year, month, day } = parseCalendarDate(value);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  return toCalendarDate(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

/** Negative when `a` is before `b`, 0 when equal, positive after. Throws on invalid dates. */
export function compareCalendarDates(a: string, b: string): number {
  return toUtc(a) - toUtc(b);
}

/** Day of the week, 0 = Sunday … 6 = Saturday. Throws on an invalid date. */
export function weekdayOf(value: string): number {
  return new Date(toUtc(value)).getUTCDay();
}

/**
 * The cells of a month calendar: 6 weeks × 7 days, `null` for blanks before/after the month.
 *
 * @param month - 1–12.
 * @param weekStart - first column's weekday (0 = Sunday, 1 = Monday).
 */
export function monthGrid(year: number, month: number, weekStart = 0): (string | null)[] {
  const first = toCalendarDate(year, month, 1);
  const lead = (weekdayOf(first) - weekStart + 7) % 7;
  const length = daysInMonth(year, month);
  return Array.from({ length: 42 }, (_, cell) => {
    const day = cell - lead + 1;
    return day >= 1 && day <= length ? toCalendarDate(year, month, day) : null;
  });
}

/**
 * The calendar date of an instant in a time zone (default IST) — e.g. "today" for the user in India.
 *
 * @param instant - the moment (pass the injected clock's `now()`).
 */
export function calendarDateInZone(instant: Date, timeZone: string = DISPLAY_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const value = Object.fromEntries(parts.map((item) => [item.type, item.value]));
  return toCalendarDate(Number(value['year']), Number(value['month']), Number(value['day']));
}

export interface WallClock {
  /** 0–23. */
  readonly hour: number;
  /** 0–59. */
  readonly minute: number;
}

/** Is `value` a 24-hour wall-clock time written exactly as "HH:mm"? */
export function isWallClock(value: unknown): value is string {
  return typeof value === 'string' && CLOCK_PATTERN.test(value);
}

/**
 * Splits "HH:mm".
 *
 * @throws RangeError for anything else.
 */
export function parseWallClock(value: string): WallClock {
  const match = CLOCK_PATTERN.exec(value);
  if (!match) throw new RangeError('parseWallClock(): expected "HH:mm"');
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * Builds "HH:mm".
 *
 * @throws RangeError when hour ∉ 0–23 or minute ∉ 0–59.
 */
export function toWallClock(hour: number, minute: number): string {
  const text = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || !isWallClock(text)) {
    throw new RangeError('toWallClock(): out of range');
  }
  return text;
}

/** 24-hour → 12-hour clock: 0 → 12 AM, 12 → 12 PM, 13 → 1 PM. */
export function to12Hour(hour: number): { readonly hour12: number; readonly pm: boolean } {
  return { hour12: hour % 12 === 0 ? 12 : hour % 12, pm: hour >= 12 };
}

/**
 * 12-hour → 24-hour clock.
 *
 * @throws RangeError when `hour12` ∉ 1–12.
 */
export function from12Hour(hour12: number, pm: boolean): number {
  if (!Number.isInteger(hour12) || hour12 < 1 || hour12 > 12) throw new RangeError('from12Hour(): hour must be 1–12');
  return (hour12 % 12) + (pm ? 12 : 0);
}
