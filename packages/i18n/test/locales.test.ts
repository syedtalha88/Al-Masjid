import { describe, expect, it } from 'vitest';

import { directionOf, isLocale, LOCALES, matchLocale } from '../src/locales.ts';

describe('locales', () => {
  it('only Urdu is right-to-left', () => {
    expect(LOCALES.map(directionOf)).toEqual(['ltr', 'ltr', 'rtl', 'ltr']);
  });

  it('isLocale accepts only the four supported codes', () => {
    for (const locale of LOCALES) expect(isLocale(locale)).toBe(true);
    for (const other of ['EN', 'en-IN', 'ar', '', null, undefined, 1, {}]) expect(isLocale(other)).toBe(false);
  });

  it('matchLocale picks the first supported primary subtag, else English', () => {
    expect(matchLocale(['hi-IN', 'en'])).toBe('hi');
    expect(matchLocale(['fr-FR', 'UR_pk'])).toBe('ur');
    expect(matchLocale([' te '])).toBe('te');
    expect(matchLocale(['ta-IN', 'fr'])).toBe('en');
    expect(matchLocale([])).toBe('en');
  });
});
