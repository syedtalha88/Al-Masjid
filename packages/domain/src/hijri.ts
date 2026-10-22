// Hijri dates (00 §4.2, 09 §4): Umm al-Qura via Intl + a moon-sighting offset (global default, per-masjid override
// −2…+2) to match Indian sighting; the Hijri day begins at Maghrib. Month names are formatted by `@mc/i18n` from its
// own per-locale table (Intl's are poor in hi/te — PROGRESS F13), so this module returns numbers only.

import { addDays, calendarDateInZone, minutesOfDay, parseCalendarDate, wallClockInZone } from './time.ts';

export interface HijriDate {
  readonly year: number;
  /** 1 = Muharram … 9 = Ramadan … 12 = Dhu al-Hijjah. */
  readonly month: number;
  readonly day: number;
}

/** Allowed moon-sighting offsets in days (02 §2 masjids.hijri_offset / app_settings.global_hijri_offset). */
export const HIJRI_OFFSET_RANGE = { min: -2, max: 2 } as const;

let formatter: Intl.DateTimeFormat | null | undefined;

// Created once; `null` when the engine has no Umm al-Qura calendar (it would silently fall back to Gregorian).
const umAlQura = (): Intl.DateTimeFormat | null => {
  if (formatter === undefined) {
    const candidate = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    });
    formatter = candidate.resolvedOptions().calendar === 'islamic-umalqura' ? candidate : null;
  }
  return formatter;
};

const assertOffset = (offset: number) => {
  if (!Number.isInteger(offset) || offset < HIJRI_OFFSET_RANGE.min || offset > HIJRI_OFFSET_RANGE.max) {
    throw new RangeError('toHijri(): offset must be an integer −2…+2');
  }
};

/**
 * The Hijri date of a Gregorian calendar date.
 *
 * @param date - "YYYY-MM-DD" (the civil day in India).
 * @param offset - moon-sighting offset in days, −2…+2.
 * @param afterMaghrib - true after sunset: the Hijri day has already advanced.
 * @returns the date, or `null` when the runtime lacks the Umm al-Qura calendar.
 * @throws RangeError for a malformed date or an offset outside −2…+2.
 */
export function toHijri(date: string, offset = 0, afterMaghrib = false): HijriDate | null {
  assertOffset(offset);
  const { year, month, day } = parseCalendarDate(addDays(date, offset + (afterMaghrib ? 1 : 0)));
  const intl = umAlQura();
  if (!intl) return null;
  const parts = Object.fromEntries(
    intl.formatToParts(new Date(Date.UTC(year, month - 1, day))).map((part) => [part.type, part.value]),
  );
  return { year: Number(parts['year']), month: Number(parts['month']), day: Number(parts['day']) };
}

/** The masjid's own offset when it has one, else the global default (02 §2: absent → global). */
export function effectiveHijriOffset(masjidOffset: number | undefined, globalOffset: number): number {
  return masjidOffset ?? globalOffset;
}

/**
 * The Hijri date shown at an instant in India.
 *
 * @param now - the (drift-corrected) current instant.
 * @param maghrib - today's Maghrib "HH:mm" for the masjid / location, or `null` when unknown (no rollover).
 * @param offset - effective moon-sighting offset.
 * @returns the date plus whether it is after Maghrib (the UI shows a small "after Maghrib" note), or `null` without
 *   Umm al-Qura support.
 */
export function hijriForInstant(
  now: Date,
  maghrib: string | null,
  offset: number,
): { readonly hijri: HijriDate; readonly afterMaghrib: boolean } | null {
  const afterMaghrib = maghrib !== null && minutesOfDay(wallClockInZone(now)) >= minutesOfDay(maghrib);
  const hijri = toHijri(calendarDateInZone(now), offset, afterMaghrib);
  return hijri ? { hijri, afterMaghrib } : null;
}
