// A list of feed items as rows with category icon circles (Home "Recent Updates" — 07 A2, Masjid Detail
// Announcements — A5): title, then masjid name (when several masjids are mixed) and relative time.
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { FeedItem, MasjidProfile } from '@mc/shared/contracts/public';
import { ListRow, Skeleton, SkeletonText } from '@mc/ui/components';
import { useNavigator } from '@mc/ui/navigation';
import { useQuery } from '@tanstack/react-query';

import { templatesQuery } from '../../lib/api/queries.ts';
import { useAppData } from '../../lib/data.tsx';
import { masjidName } from '../../lib/masjid.ts';
import { ItemIcon } from './ItemIcon.tsx';
import { itemKind, itemTitle } from './lib/item-view.ts';

export interface ItemListProps {
  readonly items: readonly FeedItem[];
  readonly loading: boolean;
  /** Masjid names for mixed lists; omit for one masjid's own list. */
  readonly masjids?: ReadonlyMap<string, MasjidProfile>;
  readonly now: Date;
  /** Shown when there is nothing (and nothing loading). */
  readonly emptyText: string;
}

export function ItemList({ items, loading, masjids, now, emptyText }: ItemListProps) {
  const { t } = useTranslation();
  const { locale, format } = useLocale();
  const navigator = useNavigator();
  const { api } = useAppData();
  const templates = useQuery(templatesQuery(api)).data?.templates;

  if (items.length === 0) {
    return loading ? (
      <div aria-busy className="flex flex-col gap-3">
        {[0, 1, 2].map((row) => (
          <span key={row} className="flex items-center gap-3 py-2">
            <Skeleton className="size-12 rounded-full" />
            <SkeletonText lines={2} className="flex-1" />
          </span>
        ))}
      </div>
    ) : (
      <p className="py-4 type-callout text-text-secondary">{emptyText}</p>
    );
  }
  return (
    <ul className="flex flex-col">
      {items.map((item) => {
        const masjid = masjids?.get(item.masjidId);
        const meta = [masjid ? masjidName(masjid, locale) : null, format.relative(new Date(item.publishedAt), now)]
          .filter(Boolean)
          .join(' · ');
        return (
          <li key={item.publicId}>
            <ListRow
              leading={<ItemIcon item={item} />}
              title={itemTitle(item, locale, templates, t(`item.${itemKind(item)}`))}
              subtitle={meta}
              chevron
              onPress={() => {
                navigator.push(`/items/${item.publicId}`);
              }}
            />
          </li>
        );
      })}
    </ul>
  );
}
