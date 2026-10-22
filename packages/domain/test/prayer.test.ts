import { readFileSync } from 'node:fs';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  CALC_METHODS,
  computeDay,
  dailySlots,
  isRamadanActive,
  JAMAAT_NOW_MS,
  type MasjidSchedule,
  nextJamaat,
  nextRamadanEvent,
  type PrayerConfig,
  PRAYERS,
  ramadanTimes,
  resolveSchedule,
} from '../src/prayer.ts';
import { addDays, addMinutesClamped, istInstant, minutesOfDay } from '../src/time.ts';

// T2.1 `prayer` (00 §4.2, 01 §5.7, DECISIONS #15). Golden oracle: test/fixtures/prayer-golden.json (sources inside).

interface GoldenCase {
  readonly city: string;
  readonly lat: number;
  readonly lng: number;
  readonly date: string;
  readonly fajr: string;
  readonly sunrise: string;
  readonly dhuhr: string;
  readonly asr: string;
  readonly maghrib: string;
  readonly isha: string;
}

const golden = JSON.parse(readFileSync(new URL('./fixtures/prayer-golden.json', import.meta.url), 'utf8')) as {
  readonly toleranceMinutes: number;
  readonly cases: readonly GoldenCase[];
};

const HYDERABAD = { lat: 17.385, lng: 78.4867 };

const auto = (jamaat: Partial<PrayerConfig> = {}): PrayerConfig => ({
  adhanMode: 'auto',
  jamaatMode: 'none',
  ...jamaat,
});

const schedule = (overrides: Partial<MasjidSchedule> = {}): MasjidSchedule => ({
  coordinates: HYDERABAD,
  method: 'karachi',
  madhab: 'hanafi',
  prayers: {
    fajr: auto({ jamaatMode: 'fixed', jamaatTime: '05:30' }),
    dhuhr: auto({ jamaatMode: 'fixed', jamaatTime: '13:45' }),
    asr: auto({ jamaatMode: 'fixed', jamaatTime: '17:00' }),
    maghrib: auto({ jamaatMode: 'offset', jamaatOffsetMin: 5 }),
    isha: auto({ jamaatMode: 'fixed', jamaatTime: '20:30' }),
  },
  jumuah: [
    { seq: 2, jamaatTime: '14:30' },
    { seq: 1, khutbahTime: '13:15', jamaatTime: '13:30' },
  ],
  ...overrides,
});

describe('computeDay — golden files (7 cities × 6 dates, ±1 min)', () => {
  it('has the full oracle', () => {
    expect(golden.cases).toHaveLength(42);
    expect(new Set(golden.cases.map((item) => item.city)).size).toBe(7);
  });

  for (const item of golden.cases) {
    it(`${item.city} ${item.date}`, () => {
      const day = computeDay({ lat: item.lat, lng: item.lng }, item.date, 'karachi', 'hanafi');
      for (const name of ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const) {
        const diff = Math.abs(minutesOfDay(day[name]) - minutesOfDay(item[name]));
        expect(diff, `${name}: ours ${day[name]}, reference ${item[name]}`).toBeLessThanOrEqual(
          golden.toleranceMinutes,
        );
      }
    });
  }
});

describe('computeDay', () => {
  it('exposes sunset separately from Maghrib (Iftar uses sunset)', () => {
    const day = computeDay(HYDERABAD, '2026-06-21', 'karachi', 'hanafi');
    expect(day.sunset).toBe(day.maghrib);
  });

  it('applies per-prayer minute adjustments', () => {
    const base = computeDay(HYDERABAD, '2026-06-21', 'karachi', 'hanafi');
    const moved = computeDay(HYDERABAD, '2026-06-21', 'karachi', 'hanafi', { fajr: -3, isha: 10 });
    expect(minutesOfDay(moved.fajr) - minutesOfDay(base.fajr)).toBe(-3);
    expect(minutesOfDay(moved.isha) - minutesOfDay(base.isha)).toBe(10);
    expect(moved.dhuhr).toBe(base.dhuhr);
    expect(moved.sunset).toBe(base.sunset);
  });

  it('Shafi Asr is earlier than Hanafi Asr', () => {
    const hanafi = computeDay(HYDERABAD, '2026-06-21', 'karachi', 'hanafi');
    const shafi = computeDay(HYDERABAD, '2026-06-21', 'karachi', 'shafi');
    expect(minutesOfDay(shafi.asr)).toBeLessThan(minutesOfDay(hanafi.asr));
  });

  it('supports every stored method', () => {
    const fajr = Object.fromEntries(
      CALC_METHODS.map((method) => [method, computeDay(HYDERABAD, '2026-06-21', method, 'hanafi').fajr]),
    );
    // Fajr angles: Karachi 18°, MWL 18°, ISNA 15°, Egypt 19.5°, Umm al-Qura 18.5°.
    expect(minutesOfDay(fajr['isna'] ?? '')).toBeGreaterThan(minutesOfDay(fajr['karachi'] ?? ''));
    expect(minutesOfDay(fajr['egypt'] ?? '')).toBeLessThan(minutesOfDay(fajr['karachi'] ?? ''));
    expect(minutesOfDay(fajr['umm_al_qura'] ?? '')).toBeLessThan(minutesOfDay(fajr['karachi'] ?? ''));
    // "Other (custom)" has no stored angles (02 §2) — it calculates like Karachi; admins customise per prayer.
    expect(fajr['other_custom']).toBe(fajr['karachi']);
    // Umm al-Qura: Isha = Maghrib + 90 min.
    const uq = computeDay(HYDERABAD, '2026-06-21', 'umm_al_qura', 'hanafi');
    expect(minutesOfDay(uq.isha) - minutesOfDay(uq.maghrib)).toBe(90);
  });

  it('does not depend on the time of day or device zone of the input', () => {
    expect(computeDay(HYDERABAD, '2026-12-21', 'karachi', 'hanafi')).toEqual(
      computeDay(HYDERABAD, '2026-12-21', 'karachi', 'hanafi'),
    );
  });

  it('times are monotonic within a day anywhere in India (property)', () => {
    const india = fc.record({
      lat: fc.double({ min: 6, max: 37.5, noNaN: true }),
      lng: fc.double({ min: 68, max: 97.5, noNaN: true }),
    });
    const date = fc.integer({ min: 0, max: 3 * 366 }).map((offset) => addDays('2026-01-01', offset));
    fc.assert(
      fc.property(
        india,
        date,
        fc.constantFrom(...CALC_METHODS),
        fc.constantFrom('hanafi', 'shafi'),
        (at, day, method, madhab) => {
          const times = computeDay(at, day, method, madhab);
          const order = [times.fajr, times.sunrise, times.dhuhr, times.asr, times.maghrib, times.isha].map(
            minutesOfDay,
          );
          return order.every((value, index) => index === 0 || value > (order[index - 1] ?? 0));
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('resolveSchedule', () => {
  it('resolves auto adhan with adjustments, manual adhan and every jamaat mode', () => {
    const day = resolveSchedule(
      schedule({
        prayers: {
          fajr: auto({ adhanAdjustMin: 2, jamaatMode: 'fixed', jamaatTime: '05:30' }),
          dhuhr: { adhanMode: 'manual', adhanTime: '13:15', jamaatMode: 'offset', jamaatOffsetMin: 15 },
          asr: auto({ jamaatMode: 'none' }),
          maghrib: auto({ jamaatMode: 'offset', jamaatOffsetMin: 5 }),
          isha: { adhanMode: 'manual', adhanTime: '23:50', jamaatMode: 'offset', jamaatOffsetMin: 30 },
        },
      }),
      '2026-06-21', // a Sunday
    );
    const calc = computeDay(HYDERABAD, '2026-06-21', 'karachi', 'hanafi');
    expect(day.prayers.map((item) => item.prayer)).toEqual([...PRAYERS]);
    const [fajr, dhuhr, asr, maghrib, isha] = day.prayers;
    expect(fajr).toEqual({
      prayer: 'fajr',
      adhan: computeDay(HYDERABAD, '2026-06-21', 'karachi', 'hanafi', { fajr: 2 }).fajr,
      adhanCalculated: true,
      jamaat: '05:30',
    });
    expect(dhuhr).toEqual({ prayer: 'dhuhr', adhan: '13:15', adhanCalculated: false, jamaat: '13:30' });
    expect(asr).toEqual({ prayer: 'asr', adhan: calc.asr, adhanCalculated: true, jamaat: null });
    expect(maghrib?.jamaat).toBe(addMinutesClamped(calc.maghrib, 5));
    // An offset jamaat never spills past midnight (00 §4.2 — Isha up to 23:59 only).
    expect(isha).toEqual({ prayer: 'isha', adhan: '23:50', adhanCalculated: false, jamaat: '23:59' });
    expect(day.sunrise).toBe(calc.sunrise);
    expect(day.sunset).toBe(calc.sunset);
    expect(day.calculated).toEqual(calc);
    expect(day.isFriday).toBe(false);
  });

  it('treats incomplete settings safely (calculated adhan, no jamaat)', () => {
    const day = resolveSchedule(
      schedule({
        prayers: {
          fajr: { adhanMode: 'manual', jamaatMode: 'fixed' },
          dhuhr: auto({ jamaatMode: 'offset' }),
          asr: auto(),
          maghrib: auto(),
          isha: auto(),
        },
      }),
      '2026-06-21',
    );
    expect(day.prayers[0]).toMatchObject({ adhanCalculated: true, jamaat: null });
    expect(day.prayers[1]).toMatchObject({ jamaat: null });
  });

  it('lists Jumu‘ah jamaats in order and flags Fridays', () => {
    const day = resolveSchedule(schedule(), '2026-10-23'); // a Friday
    expect(day.isFriday).toBe(true);
    expect(day.jumuah.map((item) => item.seq)).toEqual([1, 2]);
    expect(day.jumuah[0]).toEqual({ seq: 1, khutbahTime: '13:15', jamaatTime: '13:30' });
  });

  it('throws for a malformed date', () => {
    expect(() => resolveSchedule(schedule(), '2026-02-30')).toThrow(RangeError);
  });
});

describe('dailySlots (strip: jamaat times — DECISIONS #15)', () => {
  it('shows the five jamaats', () => {
    const slots = dailySlots(resolveSchedule(schedule(), '2026-10-22'));
    expect(slots.map((slot) => slot.prayer)).toEqual(['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']);
    expect(slots[0]?.time).toBe('05:30');
  });

  it('shows the first Jumu‘ah jamaat in the Dhuhr slot on Fridays', () => {
    const slots = dailySlots(resolveSchedule(schedule(), '2026-10-23'));
    expect(slots[1]).toEqual({ prayer: 'jumuah', time: '13:30' });
  });

  it('keeps Dhuhr on a Friday without Jumu‘ah jamaats', () => {
    const slots = dailySlots(resolveSchedule(schedule({ jumuah: [] }), '2026-10-23'));
    expect(slots[1]).toEqual({ prayer: 'dhuhr', time: '13:45' });
  });
});

describe('nextJamaat', () => {
  const s = schedule();
  const thu = resolveSchedule(s, '2026-10-22');
  const fri = resolveSchedule(s, '2026-10-23');
  const at = (date: string, hhmm: string, seconds = 0) => new Date(istInstant(date, hhmm).getTime() + seconds * 1000);

  it('finds the next jamaat today', () => {
    expect(nextJamaat(thu, fri, at('2026-10-22', '06:00'))).toMatchObject({
      prayer: 'dhuhr',
      date: '2026-10-22',
      time: '13:45',
      now: false,
    });
    expect(nextJamaat(thu, fri, at('2026-10-22', '04:00'))?.prayer).toBe('fajr');
  });

  it('reports "Jamaat now" for 10 minutes after the start', () => {
    expect(JAMAAT_NOW_MS).toBe(600_000);
    expect(nextJamaat(thu, fri, at('2026-10-22', '13:45'))).toMatchObject({ prayer: 'dhuhr', now: true });
    expect(nextJamaat(thu, fri, at('2026-10-22', '13:54', 59))).toMatchObject({ prayer: 'dhuhr', now: true });
    expect(nextJamaat(thu, fri, at('2026-10-22', '13:55'))).toMatchObject({ prayer: 'asr', now: false });
  });

  it('after Isha moves on to tomorrow‘s Fajr', () => {
    expect(nextJamaat(thu, fri, at('2026-10-22', '20:41'))).toMatchObject({
      prayer: 'fajr',
      date: '2026-10-23',
      time: '05:30',
    });
    expect(nextJamaat(thu, fri, at('2026-10-22', '20:41'))?.at.toISOString()).toBe(
      at('2026-10-23', '05:30').toISOString(),
    );
  });

  it('counts down to each Jumu‘ah jamaat on Fridays', () => {
    const sat = resolveSchedule(s, '2026-10-24');
    expect(nextJamaat(fri, sat, at('2026-10-23', '06:00'))).toMatchObject({ prayer: 'jumuah', time: '13:30' });
    expect(nextJamaat(fri, sat, at('2026-10-23', '13:41'))).toMatchObject({ prayer: 'jumuah', time: '14:30' });
  });

  it('returns null when no jamaat is set at all', () => {
    const none = schedule({
      prayers: { fajr: auto(), dhuhr: auto(), asr: auto(), maghrib: auto(), isha: auto() },
      jumuah: [],
    });
    expect(
      nextJamaat(resolveSchedule(none, '2026-10-22'), resolveSchedule(none, '2026-10-23'), at('2026-10-22', '06:00')),
    ).toBeNull();
  });
});

describe('Ramadan', () => {
  const calc = computeDay(HYDERABAD, '2027-02-20', 'karachi', 'hanafi');

  it('Sehri ends at calculated Fajr minus precaution; Iftar at sunset plus precaution', () => {
    expect(ramadanTimes(calc, 0, 0)).toEqual({ sehriEnds: calc.fajr, iftar: calc.sunset });
    const careful = ramadanTimes(calc, 10, 3);
    expect(minutesOfDay(calc.fajr) - minutesOfDay(careful.sehriEnds)).toBe(10);
    expect(minutesOfDay(careful.iftar) - minutesOfDay(calc.sunset)).toBe(3);
  });

  it('refuses precautions outside 0–15 (Sehri) and 0–10 (Iftar)', () => {
    expect(() => ramadanTimes(calc, 16, 0)).toThrow(RangeError);
    expect(() => ramadanTimes(calc, 0, 11)).toThrow(RangeError);
    expect(() => ramadanTimes(calc, -1, 0)).toThrow(RangeError);
    expect(() => ramadanTimes(calc, 1.5, 0)).toThrow(RangeError);
  });

  it('is active between the configured start and end dates, inclusive', () => {
    expect(isRamadanActive('2027-02-08', '2027-02-08', '2027-03-09')).toBe(true);
    expect(isRamadanActive('2027-03-09', '2027-02-08', '2027-03-09')).toBe(true);
    expect(isRamadanActive('2027-02-07', '2027-02-08', '2027-03-09')).toBe(false);
    expect(isRamadanActive('2027-03-10', '2027-02-08', '2027-03-09')).toBe(false);
    expect(isRamadanActive('2027-02-20', undefined, '2027-03-09')).toBe(false);
    expect(isRamadanActive('2027-02-20', '2027-02-08', undefined)).toBe(false);
  });

  it('counts down to the next of Sehri and Iftar', () => {
    const today = { date: '2027-02-20', times: { sehriEnds: '05:20', iftar: '18:25' } };
    const tomorrow = { date: '2027-02-21', times: { sehriEnds: '05:19', iftar: '18:26' } };
    const at = (hhmm: string) => istInstant('2027-02-20', hhmm);
    expect(nextRamadanEvent(today, tomorrow, at('03:00'))).toMatchObject({
      kind: 'sehri',
      date: '2027-02-20',
      time: '05:20',
    });
    expect(nextRamadanEvent(today, tomorrow, at('05:20'))).toMatchObject({ kind: 'iftar', time: '18:25' });
    expect(nextRamadanEvent(today, tomorrow, at('18:25'))).toMatchObject({
      kind: 'sehri',
      date: '2027-02-21',
      time: '05:19',
    });
    expect(nextRamadanEvent(today, null, at('18:25'))).toBeNull();
  });
});
