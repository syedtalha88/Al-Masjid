// Special dates and Ramadan mode (00 §4.2, 07 B11, PHASE_03 T3.3): the rules the admin screen shows live and the API
// enforces on save, in one place.
import { addDays, compareCalendarDates } from './time.ts';

/** How far from today (IST) a special date or a Ramadan date may lie, either way. */
export const SPECIAL_DATE_WINDOW_DAYS = 400;
/** 1–5 times per special date (02 special_timings). */
export const SPECIAL_TIMES_MAX = 5;
/** A Ramadan is 29 or 30 days; the mode may span at most this many days, start and end included. */
export const RAMADAN_MAX_DAYS = 30;

export type SpecialDateIssue = 'date_out_of_range' | 'no_times' | 'too_many_times' | 'duplicate_time';
export type RamadanIssue = 'date_out_of_range' | 'end_before_start' | 'too_long';

const inWindow = (date: string, today: string): boolean =>
  compareCalendarDates(addDays(today, -SPECIAL_DATE_WINDOW_DAYS), date) <= 0 &&
  compareCalendarDates(date, addDays(today, SPECIAL_DATE_WINDOW_DAYS)) <= 0;

/**
 * Checks a special date (its labels and note are length-checked by the contracts).
 *
 * @param input.date - "YYYY-MM-DD".
 * @param input.times - the entry's times ("HH:mm"), in the admin's order.
 * @param today - "YYYY-MM-DD" in IST.
 * @returns the problems in a stable order (date first); empty when it can be saved.
 */
export function validateSpecialDate(
  input: { readonly date: string; readonly times: readonly { readonly time: string }[] },
  today: string,
): SpecialDateIssue[] {
  const issues: SpecialDateIssue[] = [];
  if (!inWindow(input.date, today)) issues.push('date_out_of_range');
  if (input.times.length === 0) issues.push('no_times');
  if (input.times.length > SPECIAL_TIMES_MAX) issues.push('too_many_times');
  if (new Set(input.times.map((slot) => slot.time)).size !== input.times.length) issues.push('duplicate_time');
  return issues;
}

/**
 * Checks Ramadan mode's dates (the precautions are range-checked by the contracts and `ramadanTimes`).
 *
 * @param today - "YYYY-MM-DD" in IST.
 * @returns the problems in a stable order; empty when they can be saved.
 */
export function validateRamadan(
  input: { readonly start: string; readonly end: string },
  today: string,
): RamadanIssue[] {
  const issues: RamadanIssue[] = [];
  if (!inWindow(input.start, today) || !inWindow(input.end, today)) issues.push('date_out_of_range');
  if (compareCalendarDates(input.end, input.start) < 0) issues.push('end_before_start');
  else if (compareCalendarDates(addDays(input.start, RAMADAN_MAX_DAYS - 1), input.end) < 0) issues.push('too_long');
  return issues;
}

/** True when nothing blocks saving Ramadan mode. */
export const canSaveRamadan = (issues: readonly RamadanIssue[]): boolean => issues.length === 0;

/**
 * "Notify followers" starts on for a special date today or tomorrow, off otherwise — the 00 §4.2 rule for timing
 * changes. The admin can always change it.
 */
export function notifySpecialByDefault(date: string, today: string): boolean {
  return compareCalendarDates(today, date) <= 0 && compareCalendarDates(date, addDays(today, 1)) <= 0;
}
