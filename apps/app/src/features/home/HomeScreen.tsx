// A2 Home (07 A2, ref-1/1): large title "Assalamu Alaikum" with Gregorian · Hijri date, Qibla and bell; the followed
// masjids as a snapping carousel (next jamaat + countdown + jamaat strip each); Ramadan and Eid cards; the 5 newest
// updates; empty state; pull-to-refresh. Everything renders from the persisted cache offline; the clock re-renders
// once a minute (and at midnight), so prayer, Hijri date and cards roll over without a reload.
import { effectiveHijriOffset, hijriForInstant } from '@mc/domain/hijri';
import { useHijriLabel, useLocale, useTranslation } from '@mc/i18n/react';
import { QrPosterIllustration } from '@mc/ui';
import { Button, Card, Carousel, EmptyState, IconButton, PullToRefresh, SectionHeader } from '@mc/ui/components';
import { BellIcon, CompassIcon, KeyboardIcon } from '@mc/ui/icons';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { configQuery } from '../../lib/api/queries.ts';
import { useNow } from '../../lib/clock.ts';
import { useAppData, useDeviceState } from '../../lib/data.tsx';
import { HomeMasjidCard } from './components/HomeMasjidCard.tsx';
import { RecentUpdates } from './components/RecentUpdates.tsx';
import { EidCard, RamadanCard } from './components/SeasonCards.tsx';
import { useHomeData } from './hooks/useHomeData.ts';
import { eidView, hasUnseen, prayerView, ramadanView } from './lib/home-view.ts';

export function HomeScreen() {
  const { t } = useTranslation();
  const { format } = useLocale();
  const hijriLabel = useHijriLabel();
  const navigator = useNavigator();
  const now = useNow();
  const { api } = useAppData();
  const { updatesSeenAt } = useDeviceState();
  const config = useQuery(configQuery(api));
  const data = useHomeData();

  const active = useMemo(
    () => data.masjids.flatMap((masjid) => (masjid.state === 'active' ? [masjid.bundle] : [])),
    [data.masjids],
  );
  const ramadan = useMemo(() => ramadanView(active, now), [active, now]);
  const eid = useMemo(() => eidView(active, now), [active, now]);
  const names = useMemo(() => new Map(active.map((bundle) => [bundle.masjid.id, bundle.masjid])), [active]);

  // Date line: today in IST · the Hijri date of the first followed masjid (its offset, its Maghrib rollover).
  const first = active[0];
  const hijri = hijriForInstant(
    now,
    first ? (prayerView(first, now)?.maghrib ?? null) : null,
    effectiveHijriOffset(first?.masjid.hijriOffset, config.data?.globalHijriOffset ?? 0),
  );
  const lead = [format.date(now, 'weekday'), hijri ? hijriLabel(hijri.hijri) : null].filter(Boolean).join(' · ');
  const unseen = hasUnseen(data.recent, updatesSeenAt);

  return (
    <Screen
      variant="large"
      title={t('home.greeting')}
      lead={lead}
      actions={
        <>
          <IconButton
            label={t('home.qibla')}
            icon={<CompassIcon />}
            onPointerDown={() => {
              navigator.preload('/qibla');
            }}
            onPress={() => {
              navigator.presentModal('/qibla');
            }}
          />
          <IconButton
            label={unseen ? t('home.updatesNew') : t('home.updates')}
            icon={
              <span className="relative inline-flex">
                <BellIcon />
                {unseen ? (
                  <span
                    data-unseen-dot
                    className="absolute -end-0.5 -top-0.5 size-2.5 rounded-full border-2 border-bg bg-danger"
                  />
                ) : null}
              </span>
            }
            onPress={() => {
              navigator.selectTab('updates');
            }}
          />
        </>
      }
    >
      <PullToRefresh onRefresh={data.refresh}>
        {data.empty ? (
          <EmptyState
            className="pt-8"
            illustration={<QrPosterIllustration width={180} />}
            title={t('home.emptyTitle')}
            body={t('home.emptyBody')}
            action={
              <div className="flex w-full max-w-xs flex-col gap-2">
                <Button
                  size="lg"
                  fullWidth
                  onPress={() => {
                    navigator.presentModal('/scan');
                  }}
                >
                  {t('home.emptyScan')}
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  fullWidth
                  leadingIcon={<KeyboardIcon />}
                  onPress={() => {
                    navigator.presentModal('/scan?enter=code');
                  }}
                >
                  {t('home.emptyCode')}
                </Button>
              </div>
            }
          />
        ) : (
          <div className="flex flex-col gap-4 pb-6">
            <section aria-labelledby="home-masjids" className="flex flex-col gap-1">
              <SectionHeader
                id="home-masjids"
                title={t('tabs.myMasjids')}
                onSeeAll={() => {
                  navigator.selectTab('masjids');
                }}
              />
              {data.failed ? (
                <Card className="flex flex-col items-start gap-3">
                  <p className="type-body text-text-secondary">{t('appError.body')}</p>
                  <Button variant="outline" onPress={() => void data.refresh()}>
                    {t('appError.retry')}
                  </Button>
                </Card>
              ) : (
                <Carousel label={t('tabs.myMasjids')}>
                  {data.masjids.map((masjid) => (
                    <HomeMasjidCard key={masjid.id} masjid={masjid} now={now} onRetry={data.refresh} />
                  ))}
                </Carousel>
              )}
            </section>
            {ramadan ? <RamadanCard view={ramadan} masjid={names.get(ramadan.masjidId)} /> : null}
            {eid ? <EidCard view={eid} masjid={names.get(eid.masjidId)} /> : null}
            <section aria-labelledby="home-recent" className="flex flex-col gap-1">
              <SectionHeader
                id="home-recent"
                title={t('home.recent')}
                onSeeAll={() => {
                  navigator.selectTab('updates');
                }}
              />
              <RecentUpdates items={data.recent} loading={data.recentLoading} masjids={names} now={now} />
            </section>
          </div>
        )}
      </PullToRefresh>
    </Screen>
  );
}
