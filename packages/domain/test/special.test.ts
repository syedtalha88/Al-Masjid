import { describe, expect, it } from 'vitest';

import {
  canSaveRamadan,
  notifySpecialByDefault,
  RAMADAN_MAX_DAYS,
  SPECIAL_DATE_WINDOW_DAYS,
  validateRamadan,
  validateSpecialDate,
} from '../src/special.ts';
import { addDays } from '../src/time.ts';

// PHASE_03 T3.3, 00 §4.2: a special date has 1–5 times (no time twice) and lies within ±400 days of today (IST);
// Ramadan mode runs from a start to an end date (start ≤ end, at most 30 days), both within the same window.

const TODAY = '2026-11-03';
const at = (...times: string[]) => times.map((time) => ({ time }));

describe('validateSpecialDate', () => {
  it('accepts one to five distinct times on a date inside the window', () => {
    expect(validateSpecialDate({ date: TODAY, times: at('07:30') }, TODAY)).toEqual([]);
    expect(validateSpecialDate({ date: TODAY, times: at('06:30', '07:30', '08:30', '09:30', '10:30') }, TODAY)).toEqual(
      [],
    );
  });

  it('refuses no times, more than five and the same time twice', () => {
    expect(validateSpecialDate({ date: TODAY, times: [] }, TODAY)).toEqual(['no_times']);
    expect(
      validateSpecialDate({ date: TODAY, times: at('06:00', '07:00', '08:00', '09:00', '10:00', '11:00') }, TODAY),
    ).toEqual(['too_many_times']);
    expect(validateSpecialDate({ date: TODAY, times: at('07:30', '08:30', '07:30') }, TODAY)).toEqual([
      'duplicate_time',
    ]);
  });

  it('the window is ±400 days of today, both ends included', () => {
    for (const days of [-SPECIAL_DATE_WINDOW_DAYS, 0, SPECIAL_DATE_WINDOW_DAYS]) {
      expect(validateSpecialDate({ date: addDays(TODAY, days), times: at('07:30') }, TODAY)).toEqual([]);
    }
    for (const days of [-SPECIAL_DATE_WINDOW_DAYS - 1, SPECIAL_DATE_WINDOW_DAYS + 1]) {
      expect(validateSpecialDate({ date: addDays(TODAY, days), times: at('07:30') }, TODAY)).toEqual([
        'date_out_of_range',
      ]);
    }
  });

  it('reports every problem once, date first', () => {
    expect(validateSpecialDate({ date: addDays(TODAY, 500), times: [] }, TODAY)).toEqual([
      'date_out_of_range',
      'no_times',
    ]);
  });
});

describe('validateRamadan', () => {
  it('accepts a 29- or 30-day Ramadan and a single day', () => {
    expect(validateRamadan({ start: '2027-02-08', end: '2027-03-08' }, TODAY)).toEqual([]);
    expect(validateRamadan({ start: '2027-02-08', end: addDays('2027-02-08', RAMADAN_MAX_DAYS - 1) }, TODAY)).toEqual(
      [],
    );
    expect(validateRamadan({ start: TODAY, end: TODAY }, TODAY)).toEqual([]);
  });

  it('refuses an end before the start and more than 30 days', () => {
    expect(validateRamadan({ start: '2027-03-08', end: '2027-02-08' }, TODAY)).toEqual(['end_before_start']);
    expect(validateRamadan({ start: '2027-02-08', end: addDays('2027-02-08', RAMADAN_MAX_DAYS) }, TODAY)).toEqual([
      'too_long',
    ]);
  });

  it('both dates lie within ±400 days of today', () => {
    expect(validateRamadan({ start: addDays(TODAY, 401), end: addDays(TODAY, 420) }, TODAY)).toEqual([
      'date_out_of_range',
    ]);
    expect(validateRamadan({ start: addDays(TODAY, -410), end: addDays(TODAY, -390) }, TODAY)).toEqual([
      'date_out_of_range',
    ]);
    expect(canSaveRamadan([])).toBe(true);
    expect(canSaveRamadan(['too_long'])).toBe(false);
  });
});

describe('notifySpecialByDefault', () => {
  it('is on for today and tomorrow only (00 §4.2 rule for timing changes)', () => {
    expect(notifySpecialByDefault(TODAY, TODAY)).toBe(true);
    expect(notifySpecialByDefault(addDays(TODAY, 1), TODAY)).toBe(true);
    expect(notifySpecialByDefault(addDays(TODAY, 2), TODAY)).toBe(false);
    expect(notifySpecialByDefault(addDays(TODAY, -1), TODAY)).toBe(false);
  });
});
