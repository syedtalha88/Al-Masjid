// Prayer times (00 §4.2, 01 §5.7, DECISIONS #15). Wraps `adhan` (adhan-js) for the astronomy and resolves a masjid's
// configuration — adhan auto (calculated, ± minutes) or manual; jamaat fixed, N minutes after adhan, or none — into
// IST wall-clock times. Pure: the caller passes dates and "now".

import { CalculationMethod, type CalculationParameters, Coordinates, Madhab, PrayerTimes } from 'adhan';

import type { Coordinates as LatLng } from './geo.ts';
import {
  addMinutesClamped,
  compareCalendarDates,
  istInstant,
  parseCalendarDate,
  wallClockInZone,
  weekdayOf,
} from './time.ts';

/** The five daily prayers, in order. */
export const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export type PrayerName = (typeof PRAYERS)[number];

/** Calculation methods a masjid can store (02 §1 `calc_method`). */
export const CALC_METHODS = ['karachi', 'mwl', 'isna', 'egypt', 'umm_al_qura', 'other_custom'] as const;
export type CalcMethod = (typeof CALC_METHODS)[number];
export type AsrMadhab = 'hanafi' | 'shafi';

/** A prayer's stored settings (02 §2 `masjid_timings.prayers.<name>`, camelCase as in the API contract). */
export interface PrayerConfig {
  readonly adhanMode: 'auto' | 'manual';
  /** "HH:mm" — required for manual adhan. */
  readonly adhanTime?: string | undefined;
  /** −15…15 minutes added to a calculated adhan. */
  readonly adhanAdjustMin?: number | undefined;
  readonly jamaatMode: 'fixed' | 'offset' | 'none';
  /** "HH:mm" — required for a fixed jamaat. */
  readonly jamaatTime?: string | undefined;
  /** 0…60 minutes after adhan — required for an offset jamaat. */
  readonly jamaatOffsetMin?: number | undefined;
}

export interface JumuahJamaat {
  /** 1…3. */
  readonly seq: number;
  readonly khutbahTime?: string | undefined;
  readonly jamaatTime: string;
}

/** Everything needed to resolve a masjid's day (bundle: profile + timings document). */
export interface MasjidSchedule {
  readonly coordinates: LatLng;
  readonly method: CalcMethod;
  readonly madhab: AsrMadhab;
  readonly prayers: Readonly<Record<PrayerName, PrayerConfig>>;
  readonly jumuah: readonly JumuahJamaat[];
}

/** Calculated times of one day, IST "HH:mm". `sunset` is kept apart from Maghrib (Iftar uses sunset). */
export interface CalculatedDay {
  readonly fajr: string;
  readonly sunrise: string;
  readonly dhuhr: string;
  readonly asr: string;
  readonly sunset: string;
  readonly maghrib: string;
  readonly isha: string;
}

export type PrayerAdjustments = Partial<Record<PrayerName, number>>;

export interface ResolvedPrayer {
  readonly prayer: PrayerName;
  /** "HH:mm". */
  readonly adhan: string;
  /** True when calculated (the timetable shows a small "calculated" dot — 07 A6). */
  readonly adhanCalculated: boolean;
  /** "HH:mm", or `null` when the masjid holds no jamaat for this prayer. */
  readonly jamaat: string | null;
}

export interface ResolvedDay {
  /** "YYYY-MM-DD" (IST). */
  readonly date: string;
  readonly isFriday: boolean;
  readonly sunrise: string;
  readonly sunset: string;
  /** Fajr … Isha, in order. */
  readonly prayers: readonly ResolvedPrayer[];
  /** Jumu'ah jamaats sorted by `seq` (shown on Fridays and in the Jumu'ah card). */
  readonly jumuah: readonly JumuahJamaat[];
  /** The plain calculation (no admin adjustments) — Sehri/Iftar are based on it. */
  readonly calculated: CalculatedDay;
}

// "Other (custom)" stores no angles (02 §2): it calculates like Karachi and the admin customises per prayer
// (± minutes or manual times) — DECISIONS #90.
const METHOD: Readonly<Record<CalcMethod, () => CalculationParameters>> = {
  karachi: () => CalculationMethod.Karachi(),
  mwl: () => CalculationMethod.MuslimWorldLeague(),
  isna: () => CalculationMethod.NorthAmerica(),
  egypt: () => CalculationMethod.Egyptian(),
  umm_al_qura: () => CalculationMethod.UmmAlQura(),
  other_custom: () => CalculationMethod.Karachi(),
};

/**
 * Calculated prayer times for a place and IST calendar day.
 *
 * @param coordinates - latitude/longitude (India).
 * @param date - "YYYY-MM-DD".
 * @param method - stored calculation method.
 * @param madhab - Asr shadow rule.
 * @param adjustments - minutes added per prayer (rounded to the minute like the rest).
 * @returns IST wall-clock times.
 * @throws RangeError for a malformed date, or when the sun computation fails (only possible far outside India).
 */
export function computeDay(
  coordinates: LatLng,
  date: string,
  method: CalcMethod,
  madhab: AsrMadhab,
  adjustments: PrayerAdjustments = {},
): CalculatedDay {
  const { year, month, day } = parseCalendarDate(date);
  const params = METHOD[method]();
  params.madhab = madhab === 'shafi' ? Madhab.Shafi : Madhab.Hanafi;
  params.adjustments = { ...params.adjustments, ...adjustments };
  // adhan reads only the year/month/day of the local date, so the device's time zone cannot shift the day.
  const times = new PrayerTimes(
    new Coordinates(coordinates.lat, coordinates.lng),
    new Date(year, month - 1, day),
    params,
  );
  const ist = (instant: Date) => wallClockInZone(instant);
  return {
    fajr: ist(times.fajr),
    sunrise: ist(times.sunrise),
    dhuhr: ist(times.dhuhr),
    asr: ist(times.asr),
    sunset: ist(times.sunset),
    maghrib: ist(times.maghrib),
    isha: ist(times.isha),
  };
}

const resolvePrayer = (prayer: PrayerName, config: PrayerConfig, calculated: CalculatedDay): ResolvedPrayer => {
  const manual = config.adhanMode === 'manual' ? config.adhanTime : undefined;
  const adhan = manual ?? addMinutesClamped(calculated[prayer], config.adhanAdjustMin ?? 0);
  let jamaat: string | null = null;
  if (config.jamaatMode === 'fixed' && config.jamaatTime !== undefined) jamaat = config.jamaatTime;
  if (config.jamaatMode === 'offset' && config.jamaatOffsetMin !== undefined) {
    jamaat = addMinutesClamped(adhan, config.jamaatOffsetMin);
  }
  return { prayer, adhan, adhanCalculated: manual === undefined, jamaat };
};

/**
 * A masjid's timetable for one IST day.
 *
 * @param schedule - the masjid's location, method and stored timings.
 * @param date - "YYYY-MM-DD".
 * @returns adhan + jamaat per prayer, sunrise/sunset, Jumu'ah jamaats and the plain calculation. Incomplete settings
 *   (manual without a time, fixed/offset without a value) resolve to the calculated adhan / no jamaat.
 * @throws RangeError for a malformed date.
 */
export function resolveSchedule(schedule: MasjidSchedule, date: string): ResolvedDay {
  const calculated = computeDay(schedule.coordinates, date, schedule.method, schedule.madhab);
  return {
    date,
    isFriday: weekdayOf(date) === 5,
    sunrise: calculated.sunrise,
    sunset: calculated.sunset,
    prayers: PRAYERS.map((prayer) => resolvePrayer(prayer, schedule.prayers[prayer], calculated)),
    jumuah: [...schedule.jumuah].sort((a, b) => a.seq - b.seq),
    calculated,
  };
}

/** One cell of the prayer strip. */
export interface JamaatSlot {
  readonly prayer: PrayerName | 'jumuah';
  /** Jamaat "HH:mm", or `null` when none is held. */
  readonly time: string | null;
}

/**
 * The five strip cells (jamaat times — DECISIONS #15); on Fridays the Dhuhr cell shows the first Jumu'ah jamaat.
 */
export function dailySlots(day: ResolvedDay): JamaatSlot[] {
  const first = day.jumuah[0];
  return day.prayers.map((item) =>
    item.prayer === 'dhuhr' && day.isFriday && first
      ? { prayer: 'jumuah', time: first.jamaatTime }
      : { prayer: item.prayer, time: item.jamaat },
  );
}

/** "Jamaat now" is shown for 10 minutes after a jamaat starts (07 A2). */
export const JAMAAT_NOW_MS = 10 * 60_000;

export interface NextJamaat {
  readonly prayer: PrayerName | 'jumuah';
  /** IST day of the jamaat. */
  readonly date: string;
  /** "HH:mm". */
  readonly time: string;
  readonly at: Date;
  /** True during the first 10 minutes after the start. */
  readonly now: boolean;
}

interface JamaatEvent {
  readonly prayer: PrayerName | 'jumuah';
  readonly time: string;
}

const jamaatEvents = (day: ResolvedDay): JamaatEvent[] =>
  day.prayers.flatMap((item): JamaatEvent[] => {
    if (item.prayer === 'dhuhr' && day.isFriday && day.jumuah.length > 0) {
      return day.jumuah.map((jumuah) => ({ prayer: 'jumuah', time: jumuah.jamaatTime }));
    }
    return item.jamaat === null ? [] : [{ prayer: item.prayer, time: item.jamaat }];
  });

/**
 * The jamaat to count down to: the first one today (or tomorrow, after Isha) that has not been running for 10 minutes.
 *
 * @param today - resolved IST day containing `now`.
 * @param tomorrow - the following day (gives tomorrow's Fajr after Isha).
 * @param now - the (drift-corrected) current instant.
 * @returns the jamaat, or `null` when the masjid holds none on either day.
 */
export function nextJamaat(today: ResolvedDay, tomorrow: ResolvedDay, now: Date): NextJamaat | null {
  const events = [today, tomorrow]
    .flatMap((day) =>
      jamaatEvents(day).map((event) => ({ ...event, date: day.date, at: istInstant(day.date, event.time) })),
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const next = events.find((event) => event.at.getTime() + JAMAAT_NOW_MS > now.getTime());
  return next ? { ...next, now: next.at.getTime() <= now.getTime() } : null;
}

export interface RamadanTimes {
  /** Calculated Fajr (subh sadiq) minus the masjid's precaution. */
  readonly sehriEnds: string;
  /** Calculated sunset plus the masjid's precaution. */
  readonly iftar: string;
}

const assertMinutes = (value: number, max: number, name: string) => {
  if (!Number.isInteger(value) || value < 0 || value > max)
    throw new RangeError(`ramadanTimes(): ${name} must be 0–${String(max)}`);
};

/**
 * Sehri and Iftar for a day (00 §4.2).
 *
 * @param calculated - the plain calculation (`ResolvedDay.calculated`).
 * @param sehriPrecautionMin - 0–15 minutes taken off Fajr.
 * @param iftarPrecautionMin - 0–10 minutes added to sunset.
 * @throws RangeError for precautions outside those ranges.
 */
export function ramadanTimes(
  calculated: CalculatedDay,
  sehriPrecautionMin: number,
  iftarPrecautionMin: number,
): RamadanTimes {
  assertMinutes(sehriPrecautionMin, 15, 'sehri precaution');
  assertMinutes(iftarPrecautionMin, 10, 'iftar precaution');
  return {
    sehriEnds: addMinutesClamped(calculated.fajr, -sehriPrecautionMin),
    iftar: addMinutesClamped(calculated.sunset, iftarPrecautionMin),
  };
}

/** Is Ramadan mode on for this IST day (start ≤ date ≤ end, both set)? */
export function isRamadanActive(date: string, start: string | undefined, end: string | undefined): boolean {
  return (
    start !== undefined &&
    end !== undefined &&
    compareCalendarDates(start, date) <= 0 &&
    compareCalendarDates(date, end) <= 0
  );
}

export interface RamadanDay {
  readonly date: string;
  readonly times: RamadanTimes;
}

/**
 * The next of Sehri-end and Iftar after `now`, for the Ramadan card's countdown.
 *
 * @param today - today's Ramadan times.
 * @param tomorrow - tomorrow's, or `null` when Ramadan mode ends today.
 * @returns the event, or `null` when none is left.
 */
export function nextRamadanEvent(
  today: RamadanDay,
  tomorrow: RamadanDay | null,
  now: Date,
): { readonly kind: 'sehri' | 'iftar'; readonly date: string; readonly time: string; readonly at: Date } | null {
  const events = [today, ...(tomorrow ? [tomorrow] : [])].flatMap((day) => [
    {
      kind: 'sehri' as const,
      date: day.date,
      time: day.times.sehriEnds,
      at: istInstant(day.date, day.times.sehriEnds),
    },
    { kind: 'iftar' as const, date: day.date, time: day.times.iftar, at: istInstant(day.date, day.times.iftar) },
  ]);
  return events.find((event) => event.at.getTime() > now.getTime()) ?? null;
}
