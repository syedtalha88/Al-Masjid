// Timing validation (00 §4.2, PHASE_03 T3.2): the rules the admin editor shows live and the API enforces on save, in one
// place. Calculated adhan times move every day, so the rules are checked over a range of days; each problem is reported
// once, with the first date it happens on (the editor says "from 3 Nov").
import { type MasjidSchedule, type PrayerName, PRAYERS, type ResolvedPrayer, resolveSchedule } from './prayer.ts';
import { addDays, minutesOfDay } from './time.ts';

export type TimingIssueCode =
  /** A jamaat earlier than its adhan — also an Isha jamaat that would cross midnight (allowed up to 23:59 only). */
  | 'jamaat_before_adhan'
  /** Isha's adhan or jamaat not after Maghrib's. */
  | 'isha_before_maghrib'
  /** A Fajr jamaat at or after sunrise (a warning: some masjids do it on purpose in winter). */
  | 'fajr_jamaat_after_sunrise'
  /** A Jumu'ah jamaat earlier than its own khutbah. */
  | 'jumuah_before_khutbah';

export interface TimingIssue {
  readonly code: TimingIssueCode;
  readonly prayer: PrayerName | 'jumuah';
  readonly severity: 'error' | 'warning';
  /** First IST date it happens on (absent for Jumu'ah rules, which do not depend on the day). */
  readonly date?: string;
}

/** Days ahead the API checks on save (the musalli timetable shows up to 60 days ahead — 07 A6). */
export const VALIDATION_DAYS = 60;

/** 23:59 — a jamaat may not cross midnight (00 §4.2). */
const LAST_MINUTE = 23 * 60 + 59;

/** "HH:mm" strings compare correctly as text (zero-padded 24-hour clock). */
const before = (a: string, b: string): boolean => a < b;

/**
 * Checks a schedule against the 00 §4.2 rules for `days` days from `fromDate`.
 *
 * @param fromDate - "YYYY-MM-DD" (IST), usually today.
 * @param days - how many days to check (default {@link VALIDATION_DAYS}).
 * @returns issues in a stable order (prayer order, then Jumu'ah); empty when everything is fine. Only `error` issues
 *   block a save.
 */
export function validateTimings(schedule: MasjidSchedule, fromDate: string, days = VALIDATION_DAYS): TimingIssue[] {
  const found = new Map<string, TimingIssue>();
  const add = (issue: TimingIssue) => {
    const key = `${issue.code}:${issue.prayer}`;
    if (!found.has(key)) found.set(key, issue);
  };

  for (let offset = 0; offset < days; offset += 1) {
    const date = addDays(fromDate, offset);
    const day = resolveSchedule(schedule, date);
    // resolveSchedule always returns the five prayers (prayer.ts), so every name is present.
    const byName = Object.fromEntries(day.prayers.map((prayer) => [prayer.prayer, prayer])) as Record<
      PrayerName,
      ResolvedPrayer
    >;
    for (const prayer of day.prayers) {
      const config = schedule.prayers[prayer.prayer];
      // An offset jamaat is clamped to 23:59 when resolved, so a midnight crossing shows only before clamping.
      const crossesMidnight =
        config.jamaatMode === 'offset' && minutesOfDay(prayer.adhan) + (config.jamaatOffsetMin ?? 0) > LAST_MINUTE;
      if (crossesMidnight || (prayer.jamaat !== null && before(prayer.jamaat, prayer.adhan))) {
        add({ code: 'jamaat_before_adhan', prayer: prayer.prayer, severity: 'error', date });
      }
    }
    const fajr = byName.fajr;
    if (fajr.jamaat !== null && !before(fajr.jamaat, day.sunrise)) {
      add({ code: 'fajr_jamaat_after_sunrise', prayer: 'fajr', severity: 'warning', date });
    }
    const { maghrib, isha } = byName;
    const adhanOrder = !before(maghrib.adhan, isha.adhan);
    const jamaatOrder = maghrib.jamaat !== null && isha.jamaat !== null && !before(maghrib.jamaat, isha.jamaat);
    if (adhanOrder || jamaatOrder) add({ code: 'isha_before_maghrib', prayer: 'isha', severity: 'error', date });
  }

  for (const slot of schedule.jumuah) {
    if (slot.khutbahTime !== undefined && before(slot.jamaatTime, slot.khutbahTime)) {
      add({ code: 'jumuah_before_khutbah', prayer: 'jumuah', severity: 'error' });
    }
  }

  const order = [...PRAYERS, 'jumuah'] as const;
  return [...found.values()].sort((a, b) => order.indexOf(a.prayer) - order.indexOf(b.prayer));
}

/** True when nothing blocks a save (warnings allowed). */
export const canSaveTimings = (issues: readonly TimingIssue[]): boolean =>
  issues.every((issue) => issue.severity !== 'error');
