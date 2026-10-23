// Ramadan and Eid cards on Home (07 A2, 06 §6 RamadanCard): Sehri ends · Iftar with a countdown to the next of the two
// (first followed masjid in Ramadan mode); the nearest Eid salah within 3 days with its jamaat times.
import { Bdi, useLocale, useTranslation } from '@mc/i18n/react';
import type { MasjidProfile } from '@mc/shared/contracts/public';
import { Card, CountdownText, IconCircle } from '@mc/ui/components';
import { CrescentIcon } from '@mc/ui/icons';
import { Pressable } from '@mc/ui/motion';
import { useNavigator } from '@mc/ui/navigation';

import { masjidName } from '../../../lib/masjid.ts';
import type { EidView, RamadanView } from '../lib/home-view.ts';

export function RamadanCard({
  view,
  masjid,
}: {
  readonly view: RamadanView;
  readonly masjid: MasjidProfile | undefined;
}) {
  const { t } = useTranslation();
  const { locale, format } = useLocale();
  return (
    <Card variant="mint" className="flex flex-col gap-3" data-ramadan-card>
      <div className="flex items-center gap-3">
        <IconCircle tone="primary" size={44}>
          <CrescentIcon />
        </IconCircle>
        <div className="flex min-w-0 flex-col">
          <h2 className="type-headline text-primary-900">{t('home.ramadan')}</h2>
          {masjid ? <p className="truncate type-footnote text-text-secondary">{masjidName(masjid, locale)}</p> : null}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        {(['sehri', 'iftar'] as const).map((kind) => (
          <div key={kind} className={`rounded-md p-3 ${view.next?.kind === kind ? 'bg-surface' : ''}`}>
            <dt className="type-caption text-text-secondary">{t(`home.${kind}`)}</dt>
            <dd className="type-title2 text-text">
              <Bdi>{format.time(kind === 'sehri' ? view.sehriEnds : view.iftar).text}</Bdi>
            </dd>
            {view.next?.kind === kind ? (
              <dd>
                <CountdownText value={view.next.countdown} />
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
    </Card>
  );
}

export function EidCard({ view, masjid }: { readonly view: EidView; readonly masjid: MasjidProfile | undefined }) {
  const { t } = useTranslation();
  const { locale, format } = useLocale();
  const navigator = useNavigator();
  const when =
    view.inDays === 0
      ? t('home.today')
      : view.inDays === 1
        ? t('home.tomorrow')
        : format.calendarDate(view.special.date, 'medium');
  const times = format.list(view.special.times.map((entry) => format.time(entry.time).text));
  return (
    <Pressable
      kind="card"
      data-eid-card
      onPress={() => {
        navigator.push(`/masjid/${view.masjidId}`);
      }}
      className="flex w-full items-center gap-3 rounded-lg bg-surface p-4 text-start shadow-e1"
    >
      <IconCircle tone="primary" size={48}>
        <CrescentIcon />
      </IconCircle>
      <span className="flex min-w-0 flex-col">
        <span className="type-headline text-text">
          {t(view.special.type === 'eid_ul_adha' ? 'home.eidAdha' : 'home.eidFitr')}
        </span>
        <span className="type-callout text-primary-700">
          {when} · <Bdi>{times}</Bdi>
        </span>
        {masjid ? (
          <span className="truncate type-footnote text-text-secondary">{masjidName(masjid, locale)}</span>
        ) : null}
      </span>
    </Pressable>
  );
}
