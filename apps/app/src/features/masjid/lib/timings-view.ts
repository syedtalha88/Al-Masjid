// A6 Prayer Timings view model (07 A6): the table rows of a day straight from `@mc/domain` (Sunrise as a muted row,
// Jumu'ah in Dhuhr's place on Fridays), the row to tint (the next jamaat, when the day shown is today or its next day),
// the date range of the stepper, and the special dates still to come.
import type { NextJamaat, PrayerName, ResolvedDay } from '@mc/domain/prayer';
import { addDays, compareCalendarDates } from '@mc/domain/time';
import type { SpecialDate } from '@mc/shared/contracts/public';

/** The stepper's range around today (07 A6: −7 … +60 days). */
export const TIMINGS_RANGE = { before: 7, after: 60 } as const;

export type TimingRowKey = PrayerName | 'sunrise' | 'jumuah';

export interface TimingRow {
  readonly key: TimingRowKey;
  /** "HH:mm". */
  readonly adhan: string;
  /** Calculated for the masjid's location (the table shows a small dot). */
  readonly adhanCalculated: boolean;
  /** "HH:mm", or `null` (Sunrise, or no jamaat held). */
  readonly jamaat: string | null;
  /** Sunrise: shown muted, Adhan column only. */
  readonly muted: boolean;
}

/** The rows of `day`: Fajr, Sunrise, Dhuhr (Jumu'ah on Fridays: first jamaat), Asr, Maghrib, Isha. */
export function timingRows(day: ResolvedDay): TimingRow[] {
  return day.prayers.flatMap((prayer): TimingRow[] => {
    const row: TimingRow = {
      key: prayer.prayer,
      adhan: prayer.adhan,
      adhanCalculated: prayer.adhanCalculated,
      jamaat: prayer.jamaat,
      muted: false,
    };
    if (prayer.prayer === 'fajr') {
      return [row, { key: 'sunrise', adhan: day.sunrise, adhanCalculated: true, jamaat: null, muted: true }];
    }
    const jumuah = day.jumuah[0];
    if (prayer.prayer === 'dhuhr' && day.isFriday && jumuah) {
      return [{ ...row, key: 'jumuah', jamaat: jumuah.jamaatTime }];
    }
    return [row];
  });
}

/** The row to tint: the next jamaat's, when it falls on the day shown. */
export function nextRowKey(next: NextJamaat | null, date: string): TimingRowKey | null {
  if (!next || next.date !== date) return null;
  return next.prayer;
}

/** Keeps a date inside the stepper's range around `today`. */
export function clampToRange(date: string, today: string): string {
  const first = addDays(today, -TIMINGS_RANGE.before);
  const last = addDays(today, TIMINGS_RANGE.after);
  if (compareCalendarDates(date, first) < 0) return first;
  if (compareCalendarDates(date, last) > 0) return last;
  return date;
}

/** Special dates from today on, in date order, grouped by date (07 A6 Special Dates). */
export function upcomingSpecials(
  specials: readonly SpecialDate[],
  today: string,
): { readonly date: string; readonly items: readonly SpecialDate[] }[] {
  const groups = new Map<string, SpecialDate[]>();
  for (const special of [...specials].sort((a, b) => compareCalendarDates(a.date, b.date))) {
    if (compareCalendarDates(special.date, today) < 0) continue;
    const group = groups.get(special.date) ?? [];
    group.push(special);
    groups.set(special.date, group);
  }
  return [...groups].map(([date, items]) => ({ date, items }));
}
