// A8 Hadith & Quran (07 A8, ref-2/2 + ref-3/2): segmented Hadith | Quran; the newest item is the hero card (picture,
// date pill, bookmark, "Today's Hadith" when it is today's), older ones regular cards. Text only from the verified
// Content Library (CLAUDE.md §2.3). Share → the post link; Read Full → the reader; the bookmark saves on this phone.
import { calendarDateInZone } from '@mc/domain/time';
import { useTranslation } from '@mc/i18n/react';
import type { FeedItem } from '@mc/shared/contracts/public';
import { MosqueIllustration } from '@mc/ui';
import { SegmentedControl } from '@mc/ui/components';
import { DailyItemCard } from '@mc/ui/content';
import { useNavigator, useScreen } from '@mc/ui/navigation';
import { memo, useCallback, useMemo, useState } from 'react';

import { useNow } from '../../lib/clock.ts';
import { ShareSheet } from '../masjid/components/ShareSheet.tsx';
import { ContentGate } from './components/ContentGate.tsx';
import { SectionFrame } from './components/SectionFrame.tsx';
import { useSaved } from './hooks/useSaved.ts';
import { useSection } from './hooks/useSection.ts';
import { useShareItem } from './hooks/useShareItem.ts';

type Kind = 'hadith' | 'ayah';

export function HadithScreen() {
  const { params } = useScreen();
  return (
    <ContentGate>
      <HadithSection masjidId={params['masjidId'] ?? ''} />
    </ContentGate>
  );
}

function HadithSection({ masjidId }: { readonly masjidId: string }) {
  const { t } = useTranslation('content');
  const section = useSection(masjidId, 'daily_content');
  const [kind, setKind] = useState<Kind>('hadith');
  const items = useMemo(
    () => section.timeline.items.filter((item) => item.daily?.library && item.daily.kind === kind),
    [section.timeline.items, kind],
  );
  const now = useNow();
  const share = useShareItem();
  const saved = useSaved({ saved: t('savedToast'), removed: t('removedToast') });
  const masjid = section.profile;
  const { toggle } = saved;
  const { open: openShare } = share;
  const toggleSave = useCallback(
    (item: FeedItem) => {
      toggle(item, masjid);
    },
    [toggle, masjid],
  );
  const shareItem = useCallback(
    (item: FeedItem) => {
      openShare(item, masjid);
    },
    [openShare, masjid],
  );
  return (
    <SectionFrame
      title={t('hadithQuran')}
      subtitle={section.name}
      timeline={section.timeline}
      unavailable={section.unavailable}
      illustration={<MosqueIllustration width={160} />}
      emptyTitle={t('emptyHadith')}
      emptyBody={t('emptyHadithBody')}
      filteredEmpty={items.length === 0}
      header={
        <SegmentedControl
          label={t('kinds')}
          segments={[
            { id: 'hadith', label: t('hadith') },
            { id: 'ayah', label: t('quran') },
          ]}
          value={kind}
          onChange={setKind}
        />
      }
    >
      <ul className="flex flex-col gap-4">
        {items.map((item, index) => (
          <li key={item.publicId}>
            <DailyCard
              item={item}
              hero={index === 0}
              today={calendarDateInZone(new Date(item.publishedAt)) === calendarDateInZone(now)}
              saved={saved.isSaved(item.publicId)}
              onToggleSave={toggleSave}
              onShare={shareItem}
            />
          </li>
        ))}
      </ul>
      <ShareSheet target={share.target} title={t('share')} onClose={share.close} />
    </SectionFrame>
  );
}

/**
 * One hadith / ayah card (`@mc/ui/content`, the same as the admin preview) — memoised (the clock tick must not
 * re-render the Arabic text).
 */
export const DailyCard = memo(function DailyCard({
  item,
  hero,
  today,
  saved,
  onToggleSave,
  onShare,
}: {
  readonly item: FeedItem;
  readonly hero: boolean;
  readonly today: boolean;
  readonly saved: boolean;
  readonly onToggleSave: (item: FeedItem) => void;
  readonly onShare: (item: FeedItem) => void;
}) {
  const navigator = useNavigator();
  return (
    <DailyItemCard
      item={item}
      hero={hero}
      today={today}
      saved={saved}
      onToggleSave={() => {
        onToggleSave(item);
      }}
      onShare={() => {
        onShare(item);
      }}
      onReadFull={() => {
        navigator.push(`/items/${item.publicId}`);
      }}
    />
  );
});
