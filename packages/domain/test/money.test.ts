import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { formatIndianGrouping, formatRupees, isValidPaise, MAX_PAISE, parseRupees, percentOf } from '../src/money.ts';

// CLAUDE.md §6: money is integer paise, ≤ 10^12. 09 §4: "₹" + Indian grouping, no decimals unless paise ≠ 0.

describe('isValidPaise', () => {
  it('accepts non-negative safe integers up to 10^12', () => {
    expect(MAX_PAISE).toBe(1e12);
    expect(isValidPaise(0)).toBe(true);
    expect(isValidPaise(1e12)).toBe(true);
    expect(isValidPaise(1e12 + 1)).toBe(false);
    expect(isValidPaise(-1)).toBe(false);
    expect(isValidPaise(10.5)).toBe(false);
    expect(isValidPaise(Number.NaN)).toBe(false);
    expect(isValidPaise('100')).toBe(false);
  });
});

describe('formatIndianGrouping', () => {
  it('groups the last three digits, then by two', () => {
    expect(formatIndianGrouping(0)).toBe('0');
    expect(formatIndianGrouping(999)).toBe('999');
    expect(formatIndianGrouping(1000)).toBe('1,000');
    expect(formatIndianGrouping(72000)).toBe('72,000');
    expect(formatIndianGrouping(100000)).toBe('1,00,000');
    expect(formatIndianGrouping(12345678)).toBe('1,23,45,678');
    expect(formatIndianGrouping(10_000_000_000)).toBe('10,00,00,00,000');
  });

  it('refuses negative, fractional and unsafe numbers', () => {
    expect(() => formatIndianGrouping(-1)).toThrow(RangeError);
    expect(() => formatIndianGrouping(1.5)).toThrow(RangeError);
    expect(() => formatIndianGrouping(2 ** 53)).toThrow(RangeError);
  });

  it('matches Intl en-IN for every count-up frame (property)', () => {
    const intl = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e10 }), (value) => formatIndianGrouping(value) === intl.format(value)),
    );
  });
});

describe('formatRupees', () => {
  it('shows paise only when they are not zero', () => {
    expect(formatRupees(0)).toBe('₹0');
    expect(formatRupees(7_200_000)).toBe('₹72,000');
    expect(formatRupees(10_000_000)).toBe('₹1,00,000');
    expect(formatRupees(7_200_050)).toBe('₹72,000.50');
    expect(formatRupees(5)).toBe('₹0.05');
  });

  it('refuses invalid amounts', () => {
    expect(() => formatRupees(-100)).toThrow(RangeError);
    expect(() => formatRupees(1.5)).toThrow(RangeError);
    expect(() => formatRupees(MAX_PAISE + 1)).toThrow(RangeError);
  });
});

describe('parseRupees', () => {
  it('reads what an admin types', () => {
    expect(parseRupees('72000')).toBe(7_200_000);
    expect(parseRupees('1,00,000')).toBe(10_000_000);
    expect(parseRupees(' ₹ 72,000.5 ')).toBe(7_200_050);
    expect(parseRupees('72000.05')).toBe(7_200_005);
    expect(parseRupees('0')).toBe(0);
    expect(parseRupees('.5')).toBe(50);
  });

  it('rejects anything ambiguous', () => {
    for (const text of ['', '₹', '-5', '1.234', '1e5', 'abc', '72 000', '1,,000', '1.2.3', '10000000001', '٧٢']) {
      expect(parseRupees(text), text).toBeNull();
    }
  });

  it('round-trips with formatRupees (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_PAISE }), (paise) => parseRupees(formatRupees(paise)) === paise),
    );
  });
});

describe('percentOf', () => {
  it('is a whole percentage, not capped above 100 (the bar caps itself — 00 §4.3)', () => {
    expect(percentOf(7_200_000, 10_000_000)).toBe(72);
    expect(percentOf(0, 10_000_000)).toBe(0);
    expect(percentOf(12_500_000, 10_000_000)).toBe(125);
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(100, 0)).toBe(0);
  });
});
