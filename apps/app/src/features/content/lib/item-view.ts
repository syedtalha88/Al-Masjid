// How a feed item presents itself in lists (Home recent updates, Updates — 07 A2, A13): its category (icon + tone) and
// a one-line title. Template notices take the template's title in the app language; free text keeps the admin's words.
import type { Locale } from '@mc/i18n/locales';
import type { FeedItem, NoticeTemplate } from '@mc/shared/contracts/public';

export type ItemKind =
  'announcement' | 'event' | 'facilities' | 'timing' | 'hadith' | 'ayah' | 'dua' | 'campaign' | 'chanda' | 'video';

/** The list category of an item (decides its icon circle). */
export function itemKind(item: FeedItem): ItemKind {
  switch (item.type) {
    case 'announcement': {
      const category = item.announcement?.category ?? 'general';
      return category === 'general' ? 'announcement' : category;
    }
    case 'timing_update':
      return 'timing';
    case 'daily_content':
      return item.daily?.kind ?? 'hadith';
    case 'dua_request':
      return 'dua';
    case 'campaign':
      return 'campaign';
    case 'chanda_update':
      return 'chanda';
    case 'video':
      return 'video';
  }
}

/**
 * The item's one-line title: the admin's title, else the template's title in `locale` (English when missing), else the
 * first line of the body, else the category label.
 *
 * @param fallback - the localized label of `itemKind(item)` ("Request for Dua").
 */
export function itemTitle(
  item: FeedItem,
  locale: Locale,
  templates: readonly NoticeTemplate[] | undefined,
  fallback: string,
): string {
  const own = item.title?.trim();
  if (own) return own;
  if (item.templateKey) {
    const template = templates?.find((entry) => entry.key === item.templateKey);
    if (template) return template.title[locale] || template.title.en;
  }
  const firstLine = item.body?.split('\n').find((line) => line.trim() !== '');
  return firstLine?.trim() ?? fallback;
}
