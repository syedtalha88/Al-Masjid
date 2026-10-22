import { afterEach, describe, expect, it, vi } from 'vitest';

import { effectiveHijriOffset, hijriForInstant, toHijri } from '../src/hijri.ts';

// 00 §4.2: Hijri via Intl Umm al-Qura + offset (global default, per-masjid override −2…+2) to match Indian moon
// sighting; the Hijri day changes at Maghrib. Oracle: Aladhan `gToH?calendarMethod=UAQ` (Umm al-Qura), queried
// 22 Oct 2026 — 18 Feb 2026 = 1 Ramadan 1447, 20 Mar 2026 = 1 Shawwal 1447, 16 Jun 2026 = 1 Muharram 1448,
// 22 Oct 2026 = 11 Jumada I 1448, 31 Dec 2026 = 22 Rajab 1448, 8 Feb 2027 = 1 Ramadan 1448.

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toHijri', () => {
  it('converts known Umm al-Qura dates', () => {
    expect(toHijri('2026-02-18')).toEqual({ year: 1447, month: 9, day: 1 });
    expect(toHijri('2026-03-20')).toEqual({ year: 1447, month: 10, day: 1 });
    expect(toHijri('2026-06-16')).toEqual({ year: 1448, month: 1, day: 1 });
    expect(toHijri('2026-10-22')).toEqual({ year: 1448, month: 5, day: 11 });
    expect(toHijri('2026-12-31')).toEqual({ year: 1448, month: 7, day: 22 });
    expect(toHijri('2027-02-08')).toEqual({ year: 1448, month: 9, day: 1 });
  });

  it('applies the moon-sighting offset in days', () => {
    // India usually sights the moon a day after Makkah: offset −1 → 18 Feb 2026 is still 29 Sha'ban.
    expect(toHijri('2026-02-18', -1)).toEqual({ year: 1447, month: 8, day: 29 });
    expect(toHijri('2026-02-18', -2)).toEqual({ year: 1447, month: 8, day: 28 });
    expect(toHijri('2026-03-19', 1)).toEqual({ year: 1447, month: 10, day: 1 });
    expect(toHijri('2026-03-19', 2)).toEqual({ year: 1447, month: 10, day: 2 });
  });

  it('moves to the next Hijri day after Maghrib', () => {
    expect(toHijri('2026-02-17', 0, true)).toEqual({ year: 1447, month: 9, day: 1 });
    expect(toHijri('2026-02-17', -1, true)).toEqual({ year: 1447, month: 8, day: 29 });
  });

  it('refuses offsets outside −2…+2 and malformed dates', () => {
    expect(() => toHijri('2026-10-22', 3)).toThrow(RangeError);
    expect(() => toHijri('2026-10-22', -3)).toThrow(RangeError);
    expect(() => toHijri('2026-10-22', 0.5)).toThrow(RangeError);
    expect(() => toHijri('2026-02-30')).toThrow(RangeError);
  });

  it('returns null when the browser has no Umm al-Qura calendar (the Hijri line is then hidden)', async () => {
    vi.resetModules();
    const Real = Intl.DateTimeFormat;
    // An engine without the calendar silently resolves to Gregorian.
    class GregorianOnly extends Real {
      constructor(_locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
        super('en-u-ca-gregory', options);
      }
    }
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(GregorianOnly);
    const fresh = await import('../src/hijri.ts');
    expect(fresh.toHijri('2026-10-22')).toBeNull();
    expect(fresh.hijriForInstant(new Date(Date.UTC(2026, 9, 22, 6)), '18:00', 0)).toBeNull();
  });
});

describe('effectiveHijriOffset', () => {
  it('uses the masjid override, else the global default', () => {
    expect(effectiveHijriOffset(undefined, -1)).toBe(-1);
    expect(effectiveHijriOffset(1, -1)).toBe(1);
    expect(effectiveHijriOffset(0, -1)).toBe(0);
  });
});

describe('hijriForInstant', () => {
  // 17 Feb 2026 in IST; Maghrib 18:21.
  const at = (hh: number, mm: number) => new Date(Date.UTC(2026, 1, 17, hh, mm) - 330 * 60_000);

  it('rolls over at Maghrib in India', () => {
    expect(hijriForInstant(at(18, 20), '18:21', 0)).toEqual({
      hijri: { year: 1447, month: 8, day: 29 },
      afterMaghrib: false,
    });
    expect(hijriForInstant(at(18, 21), '18:21', 0)).toEqual({
      hijri: { year: 1447, month: 9, day: 1 },
      afterMaghrib: true,
    });
    expect(hijriForInstant(at(23, 59), '18:21', 0)).toEqual({
      hijri: { year: 1447, month: 9, day: 1 },
      afterMaghrib: true,
    });
  });

  it('uses the IST calendar day, not the device day', () => {
    // 01:00 IST on 18 Feb = 19:30 UTC on 17 Feb: still the same Hijri day as the evening before.
    expect(hijriForInstant(new Date(Date.UTC(2026, 1, 17, 19, 30)), '18:21', 0)?.hijri).toEqual({
      year: 1447,
      month: 9,
      day: 1,
    });
  });

  it('never rolls over without a Maghrib time', () => {
    expect(hijriForInstant(at(23, 0), null, 0)).toEqual({
      hijri: { year: 1447, month: 8, day: 29 },
      afterMaghrib: false,
    });
  });
});
