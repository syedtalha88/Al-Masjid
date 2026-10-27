import { describe, expect, it } from 'vitest';

import type { MasjidSchedule, PrayerConfig } from '../src/prayer.ts';
import { canSaveTimings, validateTimings } from '../src/timings.ts';

// PHASE_03 T3.2, 00 §4.2 validation: jamaat ≥ adhan (an Isha jamaat may not cross midnight), Isha after Maghrib,
// Jumu'ah jamaat after its khutbah — errors; Fajr jamaat at/after sunrise — warning. Calculated adhan times move every
// day, so the rules are checked over a range of days and each problem is reported once, with its first date.
// Hyderabad, late October: Fajr ≈ 04:58, sunrise ≈ 06:11, Maghrib ≈ 17:51, Isha ≈ 19:03 (Karachi, Hanafi).

const fixed = (time: string): PrayerConfig => ({
  adhanMode: 'auto',
  adhanAdjustMin: 0,
  jamaatMode: 'fixed',
  jamaatTime: time,
});
const HYDERABAD = { lat: 17.385, lng: 78.4867 };
const FROM = '2026-10-21';

const schedule = (
  prayers: Partial<Record<'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha', PrayerConfig>> = {},
  jumuah: MasjidSchedule['jumuah'] = [{ seq: 1, khutbahTime: '13:15', jamaatTime: '13:30' }],
): MasjidSchedule => ({
  coordinates: HYDERABAD,
  method: 'karachi',
  madhab: 'hanafi',
  prayers: {
    fajr: fixed('05:30'),
    dhuhr: fixed('13:30'),
    asr: fixed('16:45'),
    maghrib: { adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'offset', jamaatOffsetMin: 5 },
    isha: fixed('20:30'),
    ...prayers,
  },
  jumuah,
});

describe('validateTimings', () => {
  it('a sensible schedule has no issues over the next 60 days', () => {
    expect(validateTimings(schedule(), FROM)).toEqual([]);
  });

  it('jamaat before its (calculated) adhan → error, once, with the first date', () => {
    expect(validateTimings(schedule({ isha: fixed('19:00') }), FROM)).toEqual([
      { code: 'jamaat_before_adhan', prayer: 'isha', severity: 'error', date: FROM },
    ]);
  });

  it('an Isha jamaat that would cross midnight → error (allowed up to 23:59 only)', () => {
    const late: PrayerConfig = { adhanMode: 'manual', adhanTime: '23:30', jamaatMode: 'offset', jamaatOffsetMin: 45 };
    expect(validateTimings(schedule({ isha: late }), FROM)).toEqual([
      { code: 'jamaat_before_adhan', prayer: 'isha', severity: 'error', date: FROM },
    ]);
  });

  it('Isha before Maghrib → error', () => {
    const early: PrayerConfig = { adhanMode: 'manual', adhanTime: '17:40', jamaatMode: 'fixed', jamaatTime: '20:30' };
    expect(validateTimings(schedule({ isha: early }), FROM)).toEqual([
      { code: 'isha_before_maghrib', prayer: 'isha', severity: 'error', date: FROM },
    ]);
  });

  it('Fajr jamaat at or after sunrise → warning (not an error)', () => {
    expect(validateTimings(schedule({ fajr: fixed('06:30') }), FROM)).toEqual([
      { code: 'fajr_jamaat_after_sunrise', prayer: 'fajr', severity: 'warning', date: FROM },
    ]);
  });

  it("Jumu'ah jamaat before its khutbah → error", () => {
    expect(validateTimings(schedule({}, [{ seq: 1, khutbahTime: '13:30', jamaatTime: '13:00' }]), FROM)).toEqual([
      { code: 'jumuah_before_khutbah', prayer: 'jumuah', severity: 'error' },
    ]);
  });

  it('a problem that starts later in the range is reported with that later date', () => {
    // Isha adhan is earliest around 20 Nov (≈ 18:55) and gets later again in December (≈ 18:58 on 5 Dec).
    const issues = validateTimings(schedule({ isha: fixed('18:57') }), '2026-11-20', 30);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'jamaat_before_adhan', prayer: 'isha', severity: 'error' });
    expect(issues[0]?.date !== undefined && issues[0].date > '2026-11-20').toBe(true);
    expect(validateTimings(schedule({ isha: fixed('18:57') }), '2026-11-20', 1)).toEqual([]);
  });

  it('prayers without a jamaat are not checked for jamaat rules', () => {
    const none: PrayerConfig = { adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'none' };
    expect(validateTimings(schedule({ fajr: none, isha: none }), FROM)).toEqual([]);
  });

  it('Isha jamaat not after Maghrib jamaat → error; warnings never block a save, errors do', () => {
    const maghribLate: PrayerConfig = {
      adhanMode: 'auto',
      adhanAdjustMin: 0,
      jamaatMode: 'fixed',
      jamaatTime: '20:45',
    };
    expect(validateTimings(schedule({ maghrib: maghribLate }), FROM, 1)).toEqual([
      { code: 'isha_before_maghrib', prayer: 'isha', severity: 'error', date: FROM },
    ]);
    expect(canSaveTimings([])).toBe(true);
    expect(canSaveTimings(validateTimings(schedule({ fajr: fixed('06:30') }), FROM, 1))).toBe(true);
    expect(canSaveTimings(validateTimings(schedule({ isha: fixed('19:00') }), FROM, 1))).toBe(false);
  });

  it('an offset jamaat without minutes (refused by the database validator) counts as 0 minutes', () => {
    const bare: PrayerConfig = { adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'offset' };
    expect(validateTimings(schedule({ maghrib: bare }), FROM, 1)).toEqual([]);
  });
});
