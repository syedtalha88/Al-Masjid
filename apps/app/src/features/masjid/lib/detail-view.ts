// Masjid Detail view helpers (07 A5): which section rows show (only those with content) with their unseen counts, and
// the share / directions links.
import type { ActiveMasjidBundle, FeedItem, ItemType } from '@mc/shared/contracts/public';

import { unseenCount } from '../../masjids/lib/masjids-view.ts';

export type SectionId = 'announcements' | 'hadith' | 'duas' | 'campaigns' | 'chanda' | 'bayans';

/** Overview rows in order (07 A5) and the feed type behind each (chanda comes from the bundle). */
export const SECTIONS: readonly { readonly id: SectionId; readonly type: ItemType | null }[] = [
  { id: 'announcements', type: 'announcement' },
  { id: 'hadith', type: 'daily_content' },
  { id: 'duas', type: 'dua_request' },
  { id: 'campaigns', type: 'campaign' },
  { id: 'chanda', type: null },
  { id: 'bayans', type: 'video' },
];

/** The feed types the Overview loads (first page each). */
export const SECTION_TYPES: readonly ItemType[] = SECTIONS.flatMap((section) => (section.type ? [section.type] : []));

export interface SectionRow {
  readonly id: SectionId;
  readonly unseen: number;
}

/**
 * The Overview rows: a section shows when it has content (the first page of its feed is not empty; Weekly Chanda when
 * the masjid shows it and has weeks), with the count of items not seen yet.
 *
 * @param pages - first feed page per type (missing = still loading → the row waits).
 * @param followedAt - when this device followed the masjid (`null` when not followed: nothing counts as new).
 */
export function sectionRows(
  bundle: ActiveMasjidBundle,
  pages: ReadonlyMap<ItemType, readonly FeedItem[]>,
  seenAt: string | undefined,
  followedAt: string | null,
): SectionRow[] {
  return SECTIONS.flatMap((section): SectionRow[] => {
    if (section.type === null) {
      return bundle.masjid.showChanda && (bundle.chanda?.weeks.length ?? 0) > 0 ? [{ id: section.id, unseen: 0 }] : [];
    }
    const items = pages.get(section.type) ?? [];
    if (items.length === 0) return [];
    return [{ id: section.id, unseen: followedAt === null ? 0 : unseenCount(items, seenAt, followedAt) }];
  });
}

/** The follow link people share (`/m/:code`, 03 §3) — opens the landing with the preview card. */
export const followLink = (origin: string, followCode: string): string =>
  `${origin}/m/${encodeURIComponent(followCode)}`;

/** WhatsApp share URL (a plain link — opens WhatsApp or its web page; nothing is sent by us). */
export const whatsappLink = (text: string): string => `https://wa.me/?text=${encodeURIComponent(text)}`;

/** Google Maps directions to the masjid (07 A5 Directions, opens in a new tab). */
export const directionsLink = (lat: number, lng: number): string =>
  `https://www.google.com/maps/dir/?api=1&destination=${String(lat)},${String(lng)}`;
