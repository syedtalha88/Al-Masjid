// A7 Announcements (07 A7, ref-2/1 + ref-3/1): a masjid's notices newest first, chips All · General · Events ·
// Facilities · Timing, AnnouncementCards (icon by category, title, time, body, tags, event date). Tap → the notice.
import { useTranslation } from '@mc/i18n/react';
import type { FeedItem } from '@mc/shared/contracts/public';
import { MosqueIllustration } from '@mc/ui';
import { ChipGroup } from '@mc/ui/components';
import {
  ANNOUNCEMENT_FILTERS,
  type AnnouncementFilter,
  AnnouncementItemCard,
  filterAnnouncements,
} from '@mc/ui/content';
import { useNavigator, useScreen } from '@mc/ui/navigation';
import { useQuery } from '@tanstack/react-query';
import { memo, useMemo, useState } from 'react';

import { templatesQuery } from '../../lib/api/queries.ts';
import { useNow } from '../../lib/clock.ts';
import { useAppData } from '../../lib/data.tsx';
import { ContentGate } from './components/ContentGate.tsx';
import { SectionFrame } from './components/SectionFrame.tsx';
import { useSection } from './hooks/useSection.ts';

export function AnnouncementsScreen() {
  const { params } = useScreen();
  return (
    <ContentGate>
      <Announcements masjidId={params['masjidId'] ?? ''} />
    </ContentGate>
  );
}

function Announcements({ masjidId }: { readonly masjidId: string }) {
  const { t } = useTranslation('content');
  const section = useSection(masjidId, 'announcement');
  const [filter, setFilter] = useState<AnnouncementFilter>('all');
  const items = useMemo(() => filterAnnouncements(section.timeline.items, filter), [section.timeline.items, filter]);
  const now = useNow();
  return (
    <SectionFrame
      title={t('announcements')}
      subtitle={section.name}
      timeline={section.timeline}
      unavailable={section.unavailable}
      illustration={<MosqueIllustration width={160} />}
      emptyTitle={t('emptyAnnouncements')}
      emptyBody={t('emptyAnnouncementsBody')}
      filteredEmpty={items.length === 0}
      header={
        <ChipGroup
          className="mx-bleed"
          label={t('filters')}
          chips={ANNOUNCEMENT_FILTERS.map((id) => ({ id, label: t(`chip.${id}`) }))}
          value={filter}
          onChange={setFilter}
        />
      }
    >
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.publicId}>
            <AnnouncementRow item={item} now={now} />
          </li>
        ))}
      </ul>
    </SectionFrame>
  );
}

/** One card (`@mc/ui/content`, the same as the admin preview) — memoised so the clock tick and other rows do not
 * re-render it. */
export const AnnouncementRow = memo(function AnnouncementRow({
  item,
  now,
  masjid,
}: {
  readonly item: FeedItem;
  readonly now: Date;
  readonly masjid?: string | undefined;
}) {
  const navigator = useNavigator();
  const { api } = useAppData();
  const templates = useQuery(templatesQuery(api)).data?.templates;
  return (
    <AnnouncementItemCard
      item={item}
      templates={templates}
      now={now}
      masjid={masjid}
      onPress={() => {
        navigator.push(`/items/${item.publicId}`);
      }}
    />
  );
});
