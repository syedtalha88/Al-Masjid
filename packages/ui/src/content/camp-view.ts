// Blood donation camps (00 §4.13, 07 A22, DECISIONS #104 / #132): an announcement from the `blood_donation_camp`
// template is a camp from its params — date, hours (IST, may run past midnight), place and the organiser's number. Home
// and Masjid Detail show a card while the camp is upcoming or running; it goes at the end of its hours. Pure and small
// (Home's startup code imports it); the card itself loads on demand.
import { isE164 } from '@mc/domain/phone';
import { isCalendarDate, istWindow, isWallClock } from '@mc/domain/time';
import type { FeedItem } from '@mc/shared/contracts/public';

/** The notice template a camp is published with (seeded by `@mc/i18n/templates`). */
export const BLOOD_CAMP_TEMPLATE = 'blood_donation_camp';

export interface BloodCamp {
  readonly item: FeedItem;
  /** "YYYY-MM-DD". */
  readonly date: string;
  /** "HH:mm" wall-clock times in IST. */
  readonly hours: { readonly start: string; readonly end: string };
  readonly place: string;
  /** E.164 — only ever inside the WhatsApp link and the formatted notice text. */
  readonly contact: string;
  readonly start: Date;
  readonly end: Date;
}

/** The camp an item announces, or `null` (another notice, or params that do not fit the template). */
export function bloodCampOf(item: FeedItem): BloodCamp | null {
  if (item.type !== 'announcement' || item.templateKey !== BLOOD_CAMP_TEMPLATE) return null;
  const params = item.templateParams ?? {};
  const { date, hours, place, contact } = params;
  if (!isCalendarDate(date) || typeof place !== 'string' || !isE164(contact)) return null;
  if (typeof hours !== 'object' || !isWallClock(hours.start) || !isWallClock(hours.end)) return null;
  const range = { start: hours.start, end: hours.end };
  const { start, end } = istWindow(date, range);
  return { item, date, hours: range, place, contact, start, end };
}

/**
 * The camps to show at `now`: not yet over (upcoming or running), soonest first, each item once (the same item can be
 * in several lists).
 */
export function upcomingCamps(items: Iterable<FeedItem>, now: Date): BloodCamp[] {
  const camps = new Map<string, BloodCamp>();
  for (const item of items) {
    const camp = bloodCampOf(item);
    if (camp && camp.end.getTime() > now.getTime()) camps.set(item.publicId, camp);
  }
  return [...camps.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}
