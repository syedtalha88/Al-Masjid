// View rules of the content screens (07 A7–A9; lazy screens only — `item-view.ts` holds what Home needs): library text
// in the app language with the English fallback (00 §4.3), announcement tags and filters, dua privacy, the 30-day
// "Older" split, and notice-template arguments formatted by their declared type (02 §2).
import { isE164 } from '@mc/domain/phone';
import type { Locale } from '@mc/i18n/locales';
import type { FeedItem, LibraryEntry, NoticeTemplate } from '@mc/shared/contracts/public';

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

export { type PrayerKey, templateArguments, type TemplateFormat } from '@mc/i18n/template-args';

/** The template body in `locale`, else English (all four are required, but a blank one falls back). */
export function noticeMessage(template: NoticeTemplate, locale: Locale): string {
  const own = template.body[locale];
  return present(own) ? own : template.body.en;
}

/**
 * The phone numbers a template notice carries (params of type `phone` — the blood camp's organiser): the detail screen
 * offers "Contact on WhatsApp" for each (DECISIONS #132).
 */
export function templatePhones(item: FeedItem, template: NoticeTemplate | undefined): string[] {
  if (!template || item.templateKey !== template.key) return [];
  return template.params.flatMap((param) => {
    const value = item.templateParams?.[param.name];
    return param.type === 'phone' && typeof value === 'string' && isE164(value) ? [value] : [];
  });
}
