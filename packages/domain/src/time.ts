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
 * India Standard Time is UTC+05:30 all year (no daylight saving since 1945): wall clock ↔ instant is a fixed shift, done
 * by arithmetic rather than Intl.
 */
const IST_OFFSET_MS = 330 * 60_000;

/** Formatters per zone — building an `Intl.DateTimeFormat` is expensive; these run per prayer and per feed item. */
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const timeFormats = new Map<string, Intl.DateTimeFormat>();

const partsOf = (format: Intl.DateTimeFormat, instant: Date) =>
  Object.fromEntries(format.formatToParts(instant).map((item) => [item.type, item.value]));

/**
 * The calendar date of an instant in a time zone (default IST) — e.g. "today" for the user in India.
 *
 * @param instant - the moment (pass the injected clock's `now()`).
 */
export function calendarDateInZone(instant: Date, timeZone: string = DISPLAY_TIME_ZONE): string {
  if (timeZone === DISPLAY_TIME_ZONE) {
    const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
    return toCalendarDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
  }
  let format = dateFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dateFormats.set(timeZone, format);
  }
  const value = partsOf(format, instant);
  return toCalendarDate(Number(value['year']), Number(value['month']), Number(value['day']));
}

/**
 * The wall-clock time "HH:mm" (24 h) of an instant in a time zone (default IST) — feed it to the locale's time
 * formatter (`<Time>`) instead of formatting instants with a fixed locale.
 *
 * @param instant - the moment.
 */
export function wallClockInZone(instant: Date, timeZone: string = DISPLAY_TIME_ZONE): string {
  if (timeZone === DISPLAY_TIME_ZONE) {
    const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
    return toWallClock(shifted.getUTCHours(), shifted.getUTCMinutes());
  }
  let format = timeFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    timeFormats.set(timeZone, format);
  }
  const value = partsOf(format, instant);
  return toWallClock(Number(value['hour']), Number(value['minute']));
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

// --- IST wall clock, rollover timers and server clock drift (T2.1) ------------------------------------------------

const MINUTES_PER_DAY = 1440;

/**
 * Minutes since midnight of "HH:mm".
 *
 * @throws RangeError for anything but "HH:mm".
 */
export function minutesOfDay(hhmm: string): number {
  const { hour, minute } = parseWallClock(hhmm);
  return hour * 60 + minute;
}

/**
 * "HH:mm" for minutes since midnight.
 *
 * @throws RangeError unless `minutes` is an integer 0–1439.
 */
export function fromMinutesOfDay(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= MINUTES_PER_DAY) {
    throw new RangeError('fromMinutesOfDay(): expected an integer 0–1439');
  }
  return toWallClock(Math.floor(minutes / 60), minutes % 60);
}

/**
 * "HH:mm" moved by `minutes`, kept inside the same day (23:59 at most, 00:00 at least) — e.g. a jamaat "N minutes
 * after adhan" never spills past midnight (00 §4.2).
 *
 * @throws RangeError for a malformed time.
 */
export function addMinutesClamped(hhmm: string, minutes: number): string {
  return fromMinutesOfDay(Math.min(MINUTES_PER_DAY - 1, Math.max(0, minutesOfDay(hhmm) + Math.trunc(minutes))));
}

/**
 * The instant at which an IST calendar date shows a wall-clock time.
 *
 * @throws RangeError for a malformed date or time.
 */
export function istInstant(date: string, hhmm: string): Date {
  const { year, month, day } = parseCalendarDate(date);
  const { hour, minute } = parseWallClock(hhmm);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MS);
}

/** Milliseconds until the next whole minute (1–60 000) — schedule minute-aligned re-renders with it. */
export function msUntilNextMinute(now: Date): number {
  return 60_000 - (((now.getTime() % 60_000) + 60_000) % 60_000);
}

/** Milliseconds until the next midnight in India (1 … 86 400 000), whatever the device's own time zone. */
export function msUntilNextIstMidnight(now: Date): number {
  const tomorrow = addDays(calendarDateInZone(now), 1);
  return istInstant(tomorrow, '00:00').getTime() - now.getTime();
}

/** Device clocks closer than this to the server are left alone (00 §7: "when drift > 2 min"). */
export const CLOCK_DRIFT_THRESHOLD_MS = 120_000;
/** A response slower than this says too little about when the server wrote its `Date` header. */
const MAX_ROUND_TRIP_MS = 30_000;

/**
 * Server clock minus device clock, from an HTTP `Date` header (RFC 9110 IMF-fixdate, 1 s resolution).
 *
 * @param dateHeader - the response's `Date` header.
 * @param sentAt - device time (ms) when the request was sent.
 * @param receivedAt - device time (ms) when the response arrived.
 * @returns the offset in ms (positive = the device is behind), or `null` when the header is missing/malformed or the
 *   round trip was too slow or went backwards.
 */
export function serverClockOffset(
  dateHeader: string | null | undefined,
  sentAt: number,
  receivedAt: number,
): number | null {
  if (!dateHeader || receivedAt < sentAt || receivedAt - sentAt > MAX_ROUND_TRIP_MS) return null;
  const server = Date.parse(dateHeader);
  // Only the canonical form round-trips exactly (rejects other zones, impossible days and wrong weekdays).
  if (Number.isNaN(server) || new Date(server).toUTCString() !== dateHeader) return null;
  // The header truncates to the second: the server wrote it on average half a second later.
  return server + 500 - (sentAt + receivedAt) / 2;
}

/**
 * The offset to apply: the measured one only when the drift exceeds {@link CLOCK_DRIFT_THRESHOLD_MS}, else 0.
 */
export function effectiveClockOffset(offset: number | null): number {
  return offset !== null && Math.abs(offset) > CLOCK_DRIFT_THRESHOLD_MS ? offset : 0;
}

/** "Now" for countdowns: the device time corrected by a drift above the threshold. */
export function correctedNow(deviceNow: number, offset: number | null): Date {
  return new Date(deviceNow + effectiveClockOffset(offset));
}
