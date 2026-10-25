// View rules of the content screens (07 A7–A9; lazy screens only — `item-view.ts` holds what Home needs): library text
// in the app language with the English fallback (00 §4.3), announcement tags and filters, dua privacy, the 30-day
// "Older" split, and notice-template arguments formatted by their declared type (02 §2).
import { isCalendarDate, isWallClock } from '@mc/domain/time';
import type { Locale } from '@mc/i18n/locales';
import type { FeedItem, LibraryEntry, NoticeTemplate, TemplateParamValue } from '@mc/shared/contracts/public';

/** 00 §4.3: dua requests move under "Older" after 30 days (the server may also mark them archived). */
export const ARCHIVE_AFTER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LibraryText {
  readonly translation: string;
  /** The app language had no translation: English is shown with an "English" tag. */
  readonly fallback: boolean;
  readonly transliteration: string | undefined;
}

const present = (value: string | undefined): value is string => value !== undefined && value.trim() !== '';

/** Translation and transliteration of a library entry in `locale`, else English (00 §4.3). */
export function libraryText(entry: LibraryEntry, locale: Locale): LibraryText {
  const own = entry.translation[locale];
  const transliteration = entry.transliteration[locale];
  const englishTransliteration = entry.transliteration.en;
  return {
    translation: present(own) ? own : entry.translation.en,
    fallback: locale !== 'en' && !present(own),
    transliteration: present(transliteration)
      ? transliteration
      : present(englishTransliteration)
        ? englishTransliteration
        : undefined,
  };
}

export type AnnouncementTag = 'important' | 'general' | 'event' | 'facilities' | 'timing';
export type AnnouncementFilter = 'all' | 'general' | 'event' | 'facilities' | 'timing';
export const ANNOUNCEMENT_FILTERS: readonly AnnouncementFilter[] = ['all', 'general', 'event', 'facilities', 'timing'];

/** The tag row of an announcement card: "Important" (when flagged), then its category. */
export function announcementTags(item: FeedItem): AnnouncementTag[] {
  const category = item.announcement?.category ?? 'general';
  return item.isImportant ? ['important', category] : [category];
}

export function filterAnnouncements(items: readonly FeedItem[], filter: AnnouncementFilter): readonly FeedItem[] {
  if (filter === 'all') return items;
  return items.filter((entry) => (entry.announcement?.category ?? 'general') === filter);
}

export type DuaFilter = 'all' | 'illness' | 'inteqal' | 'other';
export const DUA_FILTERS: readonly DuaFilter[] = ['all', 'illness', 'inteqal', 'other'];

export function filterDuas(items: readonly FeedItem[], filter: DuaFilter): readonly FeedItem[] {
  if (filter === 'all') return items;
  return items.filter((entry) => entry.dua?.category === filter);
}

/**
 * Who the dua is for: the name only when the family allowed it (the API never sends private names — 02 §4.2); a
 * private request says "a brother or sister from our community" (00 §4.3); `null` when there is nothing to say.
 */
export function duaPerson(item: FeedItem): { kind: 'named'; name: string } | { kind: 'private' } | null {
  const dua = item.dua;
  if (!dua) return null;
  if (!dua.namePrivate && present(dua.personName)) return { kind: 'named', name: dua.personName.trim() };
  return dua.namePrivate ? { kind: 'private' } : null;
}

/** Archived: marked by the server, or older than {@link ARCHIVE_AFTER_DAYS} (no archive job before Phase 8). */
export function isArchived(item: FeedItem, now: Date): boolean {
  if (item.dua?.archivedAt !== undefined) return true;
  return now.getTime() - new Date(item.publishedAt).getTime() > ARCHIVE_AFTER_DAYS * DAY_MS;
}

/** Current requests and the "Older" section (07 A9), each keeping the feed order. */
export function splitArchived(
  items: readonly FeedItem[],
  now: Date,
): { current: readonly FeedItem[]; older: readonly FeedItem[] } {
  const current: FeedItem[] = [];
  const older: FeedItem[] = [];
  for (const entry of items) (isArchived(entry, now) ? older : current).push(entry);
  return { current, older };
}

/** Prayer names a `prayer` template param may hold (the keys of `common:prayer.*`). */
const PRAYER_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'jumuah'] as const;
export type PrayerKey = (typeof PRAYER_KEYS)[number];
const isPrayerKey = (value: unknown): value is PrayerKey =>
  typeof value === 'string' && (PRAYER_KEYS as readonly string[]).includes(value);

export interface TemplateFormat {
  /** "HH:mm" → "9:15 PM". */
  readonly time: (hhmm: string) => string;
  /** "YYYY-MM-DD" → "26 Sep 2026". */
  readonly date: (date: string) => string;
  /** "isha" → "Isha" in the app language. */
  readonly prayer: (name: PrayerKey) => string;
}

/**
 * The ICU arguments of a template notice: each declared param formatted by its type for the reader's locale; a range
 * `x` becomes `x_start` and `x_end`; numbers stay numbers (for plurals). Values that do not match their declared type
 * are left out, so the message fails to format and the caller falls back to the title only.
 */
export function templateArguments(
  values: Readonly<Record<string, TemplateParamValue>>,
  params: NoticeTemplate['params'],
  format: TemplateFormat,
): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  for (const param of params) {
    const value = values[param.name];
    if (value === undefined) continue;
    switch (param.type) {
      case 'time':
        if (isWallClock(value)) result[param.name] = format.time(value);
        break;
      case 'date':
        if (isCalendarDate(value)) result[param.name] = format.date(value);
        break;
      case 'time_range':
      case 'date_range': {
        if (typeof value !== 'object') break;
        const valid = param.type === 'time_range' ? isWallClock : isCalendarDate;
        const write = param.type === 'time_range' ? format.time : format.date;
        if (valid(value.start) && valid(value.end)) {
          result[`${param.name}_start`] = write(value.start);
          result[`${param.name}_end`] = write(value.end);
        }
        break;
      }
      case 'prayer':
        if (isPrayerKey(value)) result[param.name] = format.prayer(value);
        break;
      case 'number':
        if (typeof value === 'number' && Number.isFinite(value)) result[param.name] = value;
        break;
      case 'short_text':
        if (typeof value === 'string') result[param.name] = value;
        break;
    }
  }
  return result;
}

/** The template body in `locale`, else English (all four are required, but a blank one falls back). */
export function noticeMessage(template: NoticeTemplate, locale: Locale): string {
  const own = template.body[locale];
  return present(own) ? own : template.body.en;
}
