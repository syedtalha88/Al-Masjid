// Home's view model (07 A2) — pure functions from bundles + the corrected "now" to what the screen shows. All prayer
// maths is `@mc/domain`; this file only picks the day, the highlighted strip cell, and the Ramadan / Eid cards.
import { type Countdown, countdown } from '@mc/domain/countdown';
import {
  dailySlots,
  isRamadanActive,
  type JamaatSlot,
  type MasjidSchedule,
  nextJamaat,
  nextRamadanEvent,
  type PrayerName,
  ramadanTimes,
  resolveSchedule,
} from '@mc/domain/prayer';
import { addDays, calendarDateInZone, compareCalendarDates } from '@mc/domain/time';
import type { ActiveMasjidBundle, FeedItem, SpecialDate } from '@mc/shared/contracts/public';

/** The schedule the domain resolves, or `null` until the masjid's admin has set timings. */
export function scheduleOf(bundle: ActiveMasjidBundle): MasjidSchedule | null {
  if (!bundle.timings) return null;
  return {
    coordinates: { lat: bundle.masjid.lat, lng: bundle.masjid.lng },
    method: bundle.masjid.calcMethod,
    madhab: bundle.masjid.asrMadhab,
    prayers: bundle.timings.prayers,
    jumuah: bundle.timings.jumuah,
  };
}

export interface PrayerView {
  /** The day the strip shows: today, or tomorrow once today's last jamaat is over (its Fajr is next). */
  readonly date: string;
  readonly slots: readonly JamaatSlot[];
  /** Index of the highlighted (next) cell, or `null` when no jamaat is held. */
  readonly activeIndex: number | null;
  readonly next: {
    readonly prayer: PrayerName | 'jumuah';
    readonly time: string;
    readonly at: Date;
    readonly countdown: Countdown;
  } | null;
  /** Today's Maghrib (calculated) — the Hijri date rolls over then. */
  readonly maghrib: string;
}

/**
 * The prayer strip and next-jamaat panel of one masjid at `now`.
 *
 * @returns `null` when the masjid has no timings yet.
 */
export function prayerView(bundle: ActiveMasjidBundle, now: Date): PrayerView | null {
  const schedule = scheduleOf(bundle);
  if (!schedule) return null;
  const today = calendarDateInZone(now);
  const todayDay = resolveSchedule(schedule, today);
  const tomorrowDay = resolveSchedule(schedule, addDays(today, 1));
  const next = nextJamaat(todayDay, tomorrowDay, now);
  const day = next && next.date !== today ? tomorrowDay : todayDay;
  const slots = dailySlots(day);
  const index = next ? slots.findIndex((slot) => slot.prayer === next.prayer) : -1;
  return {
    date: day.date,
    slots,
    activeIndex: index >= 0 ? index : null,
    next: next ? { prayer: next.prayer, time: next.time, at: next.at, countdown: countdown(next.at, now) } : null,
    maghrib: todayDay.calculated.maghrib,
  };
}

export interface RamadanView {
  readonly masjidId: string;
  readonly sehriEnds: string;
  readonly iftar: string;
  readonly next: { readonly kind: 'sehri' | 'iftar'; readonly time: string; readonly countdown: Countdown } | null;
}

/** The Ramadan card: the first followed masjid in Ramadan mode today (07 A2), or `null`. */
export function ramadanView(bundles: readonly ActiveMasjidBundle[], now: Date): RamadanView | null {
  const today = calendarDateInZone(now);
  for (const bundle of bundles) {
    const ramadan = bundle.ramadan;
    const schedule = scheduleOf(bundle);
    if (!ramadan || !schedule || !isRamadanActive(today, ramadan.start, ramadan.end)) continue;
    const timesOn = (date: string) =>
      ramadanTimes(resolveSchedule(schedule, date).calculated, ramadan.sehriPrecautionMin, ramadan.iftarPrecautionMin);
    const tomorrow = addDays(today, 1);
    const todayTimes = timesOn(today);
    const next = nextRamadanEvent(
      { date: today, times: todayTimes },
      isRamadanActive(tomorrow, ramadan.start, ramadan.end) ? { date: tomorrow, times: timesOn(tomorrow) } : null,
      now,
    );
    return {
      masjidId: bundle.masjid.id,
      sehriEnds: todayTimes.sehriEnds,
      iftar: todayTimes.iftar,
      next: next ? { kind: next.kind, time: next.time, countdown: countdown(next.at, now) } : null,
    };
  }
  return null;
}

/** Eid card window: today and the next 3 days (07 A2). */
export const EID_WINDOW_DAYS = 3;
const EID_TYPES: ReadonlySet<SpecialDate['type']> = new Set(['eid_ul_fitr', 'eid_ul_adha']);

export interface EidView {
  readonly masjidId: string;
  readonly special: SpecialDate;
  /** 0 = today, 1 = tomorrow, … */
  readonly inDays: number;
}

/** The nearest Eid salah announced by a followed masjid within the window, or `null`. */
export function eidView(bundles: readonly ActiveMasjidBundle[], now: Date): EidView | null {
  const today = calendarDateInZone(now);
  const last = addDays(today, EID_WINDOW_DAYS);
  let best: EidView | null = null;
  for (const bundle of bundles) {
    for (const special of bundle.specialDates) {
      if (!EID_TYPES.has(special.type) || special.times.length === 0) continue;
      if (compareCalendarDates(special.date, today) < 0 || compareCalendarDates(special.date, last) > 0) continue;
      if (best && compareCalendarDates(special.date, best.special.date) >= 0) continue;
      let inDays = 0;
      while (addDays(today, inDays) !== special.date) inDays += 1;
      best = { masjidId: bundle.masjid.id, special, inDays };
    }
  }
  return best;
}

/** Newest first across masjids, at most `limit` (Home shows 5 — 07 A2); ties keep a stable order by id. */
export function mergeRecent(pages: readonly (readonly FeedItem[])[], limit: number): FeedItem[] {
  return pages
    .flat()
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.publicId.localeCompare(b.publicId))
    .slice(0, limit);
}

/** Any item newer than when the Updates tab was last opened (the bell's red dot — 07 A2). */
export function hasUnseen(items: readonly FeedItem[], seenAt: string | undefined): boolean {
  if (items.length === 0) return false;
  return seenAt === undefined || items.some((item) => item.publishedAt > seenAt);
}
