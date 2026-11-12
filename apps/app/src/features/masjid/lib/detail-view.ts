// Masjid Detail view helpers (07 A5): which section rows show (only those with content) with their unseen counts, and
// the share / directions links.
import type { ActiveMasjidBundle, FeedItem, IlmContact, ItemType } from '@mc/shared/contracts/public';

import { unseenCount } from '../../masjids/lib/masjids-view.ts';

export type SectionId =
  'announcements' | 'hadith' | 'duas' | 'adhkar' | 'ruqyah' | 'ilm' | 'campaigns' | 'needy' | 'chanda' | 'bayans';

/**
 * Overview rows in order (07 A5) and the feed type behind each (adhkar, Ruqyah, Ilm and needy people come from the
 * bundle; chanda
 * shows by the bundle, and its `chanda_update` items only count what is new — T5.6).
 */
export const SECTIONS: readonly { readonly id: SectionId; readonly type: ItemType | null }[] = [
  { id: 'announcements', type: 'announcement' },
  { id: 'hadith', type: 'daily_content' },
  { id: 'duas', type: 'dua_request' },
  { id: 'adhkar', type: null },
  { id: 'ruqyah', type: null },
  { id: 'ilm', type: null },
  { id: 'campaigns', type: 'campaign' },
  { id: 'needy', type: null },
  { id: 'chanda', type: 'chanda_update' },
  { id: 'bayans', type: 'video' },
];

/** The feed types the Overview loads (first page each). */
export const SECTION_TYPES: readonly ItemType[] = SECTIONS.flatMap((section) => (section.type ? [section.type] : []));

/**
 * The masjid's Ilm contacts for this device's Brother/Sister choice (07 A21) — a display filter, not access control
 * (DECISIONS #104). A bundle cached before T3.16 has none.
 */
export const contactsFor = (bundle: ActiveMasjidBundle, audience: IlmContact['audience']): IlmContact[] =>
  (bundle.contacts ?? []).filter((contact) => contact.audience === audience);

export interface SectionRow {
  readonly id: SectionId;
  readonly unseen: number;
}

/**
 * The Overview rows: a section shows when it has content (the first page of its feed is not empty; "Adhkar after salah"
 * when the masjid has a set; Ruqyah when the bundle counts entries; "Ask the masjid" when it lists contacts for this
 * device's audience; "Help the needy" when the bundle counts listed people (07 A23); Weekly Chanda when the masjid shows it and has weeks — also before its feed page arrived), with
 * the count of items not seen yet.
 *
 * @param pages - first feed page per type (missing = still loading → the row waits).
 * @param followedAt - when this device followed the masjid (`null` when not followed: nothing counts as new).
 * @param audience - the device's Brother/Sister choice (Ilm contacts).
 */
export function sectionRows(
  bundle: ActiveMasjidBundle,
  pages: ReadonlyMap<ItemType, readonly FeedItem[]>,
  seenAt: string | undefined,
  followedAt: string | null,
  audience: IlmContact['audience'],
): SectionRow[] {
  return SECTIONS.flatMap((section): SectionRow[] => {
    if (section.id === 'adhkar') return bundle.adhkar ? [{ id: section.id, unseen: 0 }] : []; // 07 A20 (T3.14)
    if (section.id === 'ruqyah') return (bundle.sections?.ruqyah ?? 0) > 0 ? [{ id: section.id, unseen: 0 }] : []; // A19
    if (section.id === 'ilm') return contactsFor(bundle, audience).length > 0 ? [{ id: section.id, unseen: 0 }] : []; // A21
    if (section.id === 'needy') return (bundle.sections?.needy ?? 0) > 0 ? [{ id: section.id, unseen: 0 }] : []; // A23
    if (section.type === null) return [];
    const items = pages.get(section.type) ?? [];
    const unseen = followedAt === null ? 0 : unseenCount(items, seenAt, followedAt);
    if (section.id === 'chanda') {
      // Shown by the bundle (the row must not wait for a feed page); new week entries count as they arrive.
      return bundle.masjid.showChanda && (bundle.chanda?.weeks.length ?? 0) > 0 ? [{ id: section.id, unseen }] : [];
    }
    return items.length === 0 ? [] : [{ id: section.id, unseen }];
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
