// One carousel card on Home (07 A2): the masjid row, its next jamaat with countdown and today's jamaat strip. Loading →
// a skeleton of the same height; suspended / failed → a short note.
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { ActiveMasjidBundle } from '@mc/shared/contracts/public';
import {
  Button,
  Card,
  InfoNote,
  MasjidCard,
  NextPrayerPanel,
  PrayerStrip,
  Skeleton,
  SkeletonText,
} from '@mc/ui/components';
import { useNavigator } from '@mc/ui/navigation';
import { memo, useMemo } from 'react';

import { masjidName, masjidPlace } from '../../../lib/masjid.ts';
import { mediaUrl } from '../../../lib/media.ts';
import type { HomeMasjid } from '../hooks/useHomeData.ts';
import { prayerView } from '../lib/home-view.ts';

export interface HomeMasjidCardProps {
  readonly masjid: HomeMasjid;
  readonly now: Date;
  readonly onRetry: () => Promise<void>;
}

/** Memoised: a device-state change elsewhere (Updates marking items seen) must not re-render every card. */
export const HomeMasjidCard = memo(
  function HomeMasjidCard({ masjid, now, onRetry }: HomeMasjidCardProps) {
    const { t } = useTranslation();
    if (masjid.state === 'loading') return <CardSkeleton />;
    if (masjid.state === 'active') return <ActiveCard bundle={masjid.bundle} now={now} />;
    return (
      <Card className="flex min-h-56 flex-col items-start justify-center gap-3">
        <p className="type-body text-text-secondary">
          {masjid.state === 'suspended' ? t('home.suspended') : t('home.loadFailed')}
        </p>
        {masjid.state === 'failed' ? (
          <Button variant="outline" onPress={() => void onRetry()}>
            {t('appError.retry')}
          </Button>
        ) : null}
      </Card>
    );
  },
  // Same masjid data (bundles are immutable per version) and the same minute; `onRetry` only matters on a failed card.
  (previous, next) =>
    previous.now === next.now &&
    previous.masjid.state === next.masjid.state &&
    previous.masjid.id === next.masjid.id &&
    (previous.masjid.state !== 'active' ||
      (next.masjid.state === 'active' && previous.masjid.bundle === next.masjid.bundle)),
);

function ActiveCard({ bundle, now }: { readonly bundle: ActiveMasjidBundle; readonly now: Date }) {
  const { t } = useTranslation();
  const { locale, format } = useLocale();
  const navigator = useNavigator();
  const { masjid } = bundle;
  // Recomputed once a minute (the clock's re-render) — two days of times per masjid.
  const view = useMemo(() => prayerView(bundle, now), [bundle, now]);
  const open = () => {
    navigator.push(`/masjid/${masjid.id}`);
  };
  const photo = masjid.photo ? mediaUrl(masjid.photo.key, 480) : null;
  return (
    <MasjidCard
      name={masjidName(masjid, locale)}
      place={masjidPlace(masjid)}
      photo={masjid.photo && photo ? { src: photo, thumbhash: masjid.photo.thumbhash } : null}
      onPress={open}
    >
      {view ? (
        <>
          <NextPrayerPanel
            prayer={view.next?.prayer ?? null}
            countdown={view.next?.countdown ?? null}
            emptyText={t('home.noJamaat')}
            onPress={() => {
              navigator.push(`/masjid/${masjid.id}/timings`);
            }}
          />
          <PrayerStrip
            slots={view.slots}
            activeIndex={view.activeIndex}
            label={t('home.strip', { date: format.calendarDate(view.date, 'long') })}
          />
        </>
      ) : (
        <InfoNote>{t('home.noTimings')}</InfoNote>
      )}
    </MasjidCard>
  );
}

/** Same footprint as a loaded card (no layout shift — 08 §5.4). */
function CardSkeleton() {
  return (
    <Card aria-busy className="flex flex-col gap-3">
      <span className="flex items-center gap-3">
        <Skeleton className="size-14 rounded-md" />
        <SkeletonText lines={2} className="flex-1" />
      </span>
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-md" />
    </Card>
  );
}
