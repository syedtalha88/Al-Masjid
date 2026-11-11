// A11 Weekly Chanda (07 A11, 00 §4.3, PHASE_05 T5.5): inline bar with the masjid name; a big card — "This week" (or
// the latest week) with the total, the week's dates and the masjid's note; the last 8 weeks as a ChandaChart (tap a bar
// for its amount; mirrored in Urdu); "Reported by masjid admin.". Only while the masjid shows its chanda — otherwise the
// bundle has none and the screen says there is nothing to show.
import { chandaWeekEnd } from '@mc/domain/chanda';
import { calendarDateInZone } from '@mc/domain/time';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { MosqueIllustration } from '@mc/ui';
import { Button, ChandaChart, EmptyState, InfoNote, Skeleton, SkeletonText } from '@mc/ui/components';
import { CountUp } from '@mc/ui/motion';
import { Screen, useNavigator, useScreen } from '@mc/ui/navigation';
import { useCallback, useMemo } from 'react';

import { useNow } from '../../lib/clock.ts';
import { masjidName } from '../../lib/masjid.ts';
import { ContentGate } from '../content/components/ContentGate.tsx';
import { useMasjidBundle } from '../masjid/hooks/useMasjidBundle.ts';
import { chandaView } from './lib/chanda-view.ts';

export function ChandaScreen() {
  const { params } = useScreen();
  return (
    <ContentGate>
      <Chanda masjidId={params['masjidId'] ?? ''} />
    </ContentGate>
  );
}

/** A week's first day as a Date at IST noon (date formatting only). */
const noonIst = (date: string) => new Date(`${date}T12:00:00+05:30`);

function Chanda({ masjidId }: { readonly masjidId: string }) {
  const { t } = useTranslation('content');
  const { t: tm } = useTranslation('masjid');
  const { t: tc } = useTranslation();
  const { locale, format } = useLocale();
  const navigator = useNavigator();
  const { masjid, retry } = useMasjidBundle(masjidId);
  const today = calendarDateInZone(useNow());
  const money = useCallback((paise: number) => format.money(paise), [format]);
  const bundle = masjid.state === 'active' ? masjid.bundle : null;
  const view = useMemo(
    () => (bundle?.chanda ? chandaView(bundle.chanda.weeks, bundle.masjid.chandaWeekStart, today) : null),
    [bundle, today],
  );
  const name = bundle ? masjidName(bundle.masjid, locale) : undefined;
  const range = (week: string) =>
    t('chanda.range', {
      start: format.calendarDate(week, 'medium'),
      end: format.calendarDate(chandaWeekEnd(week), 'medium'),
    });

  const back = (
    <Button
      variant="outline"
      onPress={() => {
        navigator.back();
      }}
    >
      {t('back')}
    </Button>
  );

  const body = (() => {
    if (masjid.state === 'loading') {
      return (
        <div aria-busy className="flex flex-col gap-4">
          <Skeleton className="h-32 rounded-md" />
          <SkeletonText lines={4} />
        </div>
      );
    }
    if (masjid.state === 'failed') {
      return (
        <EmptyState
          className="pt-8"
          title={tc('appError.title')}
          body={tc('appError.body')}
          action={
            <Button variant="outline" onPress={retry}>
              {tc('appError.retry')}
            </Button>
          }
        />
      );
    }
    if (masjid.state !== 'active') {
      return (
        <EmptyState
          className="pt-8"
          title={masjid.state === 'suspended' ? tm('suspended') : tm('gone')}
          action={back}
        />
      );
    }
    if (!view?.headline) {
      return (
        <EmptyState
          className="pt-8"
          illustration={<MosqueIllustration width={160} />}
          title={t('chanda.empty')}
          body={t('chanda.emptyBody')}
          action={back}
        />
      );
    }
    const { headline } = view;
    return (
      <div className="flex flex-col gap-5">
        <section
          className="flex flex-col gap-1 rounded-md bg-surface p-5 shadow-e1"
          data-chanda-week={headline.weekStart}
        >
          <h2 className="type-subhead-strong text-purple">
            {headline.isThisWeek ? t('chanda.thisWeek') : t('chanda.lastWeek')}
          </h2>
          <p className="type-amount-large text-text">
            <CountUp value={headline.amountPaise} format={money} />
          </p>
          <p className="type-footnote text-text-secondary">{range(headline.weekStart)}</p>
          {headline.note ? (
            <p dir="auto" className="mt-2 type-body text-text">
              {headline.note}
            </p>
          ) : null}
        </section>
        <ChandaChart
          label={t('chanda.chartLabel', { count: view.slots.length })}
          bars={view.slots.map((slot) => ({
            key: slot.weekStart,
            label: format.date(noonIst(slot.weekStart), 'short'),
            value: slot.amountPaise,
            valueText: slot.amountPaise === null ? '—' : format.money(slot.amountPaise),
            current: slot.current,
          }))}
          selectedText={(bar) => t('chanda.bar', { week: range(bar.key), amount: bar.valueText })}
        />
        <InfoNote>{t('chanda.reported')}</InfoNote>
      </div>
    );
  })();

  return (
    <Screen title={t('chanda.title')} {...(name ? { subtitle: name } : {})}>
      <div className="pt-2 pb-6" data-chanda-screen>
        {body}
      </div>
    </Screen>
  );
}
