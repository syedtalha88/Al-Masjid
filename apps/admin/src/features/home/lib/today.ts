// The Admin Home's today strip (07 B3): the masjid's next jamaat, resolved on the phone from the raw timings exactly as
// the musalli app does (`@mc/domain/prayer`) — so the admin sees what their followers see.
import { type MasjidSchedule, nextJamaat, type PrayerName, resolveSchedule } from '@mc/domain/prayer';
import { addDays, calendarDateInZone } from '@mc/domain/time';
import type { AdminSchedule } from '@mc/shared/contracts';

export type TodayStrip =
  | { readonly kind: 'next'; readonly prayer: PrayerName | 'jumuah'; readonly time: string; readonly tomorrow: boolean }
  | { readonly kind: 'none' } // timings set, but no jamaat held today or tomorrow
  | { readonly kind: 'unset' }; // the admin has not saved timings yet

/** The domain's schedule for an admin schedule, or `null` before the first save. */
export function scheduleOf(schedule: AdminSchedule): MasjidSchedule | null {
  if (!schedule.timings) return null;
  return {
    coordinates: { lat: schedule.masjid.lat, lng: schedule.masjid.lng },
    method: schedule.masjid.calcMethod,
    madhab: schedule.masjid.asrMadhab,
    prayers: schedule.timings.prayers,
    jumuah: schedule.timings.jumuah,
  };
}

/** What the today strip shows at `now`. */
export function todayStrip(schedule: AdminSchedule, now: Date): TodayStrip {
  const domain = scheduleOf(schedule);
  if (!domain) return { kind: 'unset' };
  const today = calendarDateInZone(now);
  const next = nextJamaat(resolveSchedule(domain, today), resolveSchedule(domain, addDays(today, 1)), now);
  if (!next) return { kind: 'none' };
  return { kind: 'next', prayer: next.prayer, time: next.time, tomorrow: next.date !== today };
}
