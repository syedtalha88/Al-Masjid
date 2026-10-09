import { describe, expect, it } from 'vitest';

import { formatters } from '../src/format.ts';
import { LOCALES } from '../src/locales.ts';

// Exact strings are asserted for our own rules (money grouping, digits, AM/PM, cut-offs); CLDR month/weekday
// names change between ICU releases, so localized words are checked structurally.
const NON_LATIN_DIGITS = /[०-९۰-۹٠-٩౦-౯]/u;
const SEP_26_0900_IST = new Date('2026-09-26T03:30:00Z');

describe.each(LOCALES)('formatters(%s)', (locale) => {
  const f = formatters(locale);

  it('formats money as ₹ with Indian grouping in every locale (09 §4, DECISIONS #38)', () => {
    expect(f.money(10_000_000)).toBe('₹1,00,000');
    expect(f.money(1_00_00_000_00)).toBe('₹1,00,00,000');
    expect(f.money(7_200_050)).toBe('₹72,000.50');
    expect(f.money(7_200_005)).toBe('₹72,000.05');
    expect(f.money(0)).toBe('₹0');
  });

  it('rejects non-integer or unsafe paise', () => {
    expect(() => f.money(1.5)).toThrow(RangeError);
    expect(() => f.money(Number.NaN)).toThrow(RangeError);
    expect(() => f.money(2 ** 53)).toThrow(RangeError);
  });

  it('formats numbers with Indian grouping and Latin digits', () => {
    expect(f.number(1204)).toBe('1,204');
    expect(f.number(1_234_567)).toBe('12,34,567');
  });

  it('formats wall-clock times as 12-hour with an upper-case Latin day period', () => {
    // One no-break space (U+00A0) in every locale so "AM" never wraps onto its own line.
    expect(f.time('05:15')).toEqual({ text: '5:15 AM', time: '5:15', period: 'AM' });
    expect(f.time('18:40')).toEqual({ text: '6:40 PM', time: '6:40', period: 'PM' });
    expect(f.time('00:00').time).toBe('12:00');
    expect(f.time('12:30').period).toBe('PM');
  });

  it('rejects malformed times', () => {
    for (const bad of ['5:15', '24:00', '12:60', '12-30', '', ' 05:15']) {
      expect(() => f.time(bad), bad).toThrow(RangeError);
    }
  });

  it('formats dates in IST with Latin digits', () => {
    // 23:30 UTC on 25 Sep is already 26 Sep in India.
    expect(f.date(new Date('2026-09-25T23:30:00Z'))).toMatch(/26/u);
    expect(f.date(SEP_26_0900_IST, 'medium')).toMatch(/26.*2026/u);
    const weekday = f.date(SEP_26_0900_IST, 'weekday');
    expect(weekday).toMatch(/26/u);
    expect(weekday).not.toBe(f.date(SEP_26_0900_IST, 'short'));
    for (const style of ['short', 'medium', 'weekday'] as const) {
      expect(f.date(SEP_26_0900_IST, style)).not.toMatch(NON_LATIN_DIGITS);
    }
  });

  it('formats relative times up to 6 days, then falls back to a date', () => {
    const now = SEP_26_0900_IST;
    const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);
    expect(f.relative(ago(2 * 3600), now)).toMatch(/2/u);
    expect(f.relative(ago(6 * 86_400), now)).toMatch(/6/u);
    expect(f.relative(ago(10 * 86_400), now)).toBe(f.date(ago(10 * 86_400), 'short'));
    const lastYear = new Date('2025-01-02T00:00:00Z');
    expect(f.relative(lastYear, now)).toBe(f.date(lastYear, 'medium'));
    expect(f.relative(ago(2 * 3600), now)).not.toMatch(NON_LATIN_DIGITS);
  });

  it('formats Hijri dates with Latin digits (Intl stub until packages/domain/hijri)', () => {
    const hijri = f.hijri(SEP_26_0900_IST);
    expect(hijri).toMatch(/1448/u);
    expect(hijri).not.toMatch(NON_LATIN_DIGITS);
  });

  it('formats lists and memoizes per locale', () => {
    expect(f.list(['A', 'B', 'C'])).toMatch(/^A.*B.*C$/u);
    expect(formatters(locale)).toBe(f);
  });
});

describe('formatters(en) exact output', () => {
  const f = formatters('en');

  it('matches the reference styles', () => {
    expect(f.relative(new Date(SEP_26_0900_IST.getTime() - 2 * 3600 * 1000), SEP_26_0900_IST)).toBe('2 hours ago');
    expect(f.relative(new Date(SEP_26_0900_IST.getTime() - 86_400 * 1000), SEP_26_0900_IST)).toBe('yesterday');
    expect(f.list(['A', 'B', 'C'])).toBe('A, B and C');
  });
});
