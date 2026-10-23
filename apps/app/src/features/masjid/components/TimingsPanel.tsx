// The "Prayer Timings" tab of Masjid Detail (07 A5): today's Adhan and Jamaat per prayer (Jumu'ah on Fridays). The full
// timetable with the date stepper, Jumu'ah card and special dates is A6 (PHASE_02 T2.9), which takes this tab's place.
import { resolveSchedule } from '@mc/domain/prayer';
import { calendarDateInZone } from '@mc/domain/time';
import { Bdi, useLocale, useTranslation } from '@mc/i18n/react';
import type { ActiveMasjidBundle } from '@mc/shared/contracts/public';
import { InfoNote, usePrayerName } from '@mc/ui/components';
import { PrayerIcon } from '@mc/ui/icons';
import { useMemo } from 'react';

import { scheduleOf } from '../../home/lib/home-view.ts';

export function TimingsPanel({ bundle, now }: { readonly bundle: ActiveMasjidBundle; readonly now: Date }) {
  const { t } = useTranslation('masjid');
  const { t: tc } = useTranslation();
  const { format } = useLocale();
  const name = usePrayerName();
  const today = calendarDateInZone(now);
  const day = useMemo(() => {
    const schedule = scheduleOf(bundle);
    return schedule ? resolveSchedule(schedule, today) : null;
  }, [bundle, today]);
  if (!day) return <InfoNote>{tc('home.noTimings')}</InfoNote>;
  const time = (value: string | null) => (value === null ? '–' : format.time(value).text);
  const firstJumuah = day.isFriday ? day.jumuah[0] : undefined;
  return (
    <table className="w-full border-separate border-spacing-y-1">
      <caption className="sr-only">{format.calendarDate(today, 'long')}</caption>
      <thead>
        <tr className="type-caption text-text-secondary">
          <th scope="col" className="sr-only">
            {t('timings')}
          </th>
          <th scope="col" className="text-end font-medium">
            {t('adhan')}
          </th>
          <th scope="col" className="text-end font-medium">
            {t('jamaat')}
          </th>
        </tr>
      </thead>
      <tbody>
        {day.prayers.map((prayer) => {
          const jumuah = prayer.prayer === 'dhuhr' && firstJumuah;
          return (
            <tr key={prayer.prayer} className="type-body text-text">
              <th scope="row" className="py-2 text-start font-normal">
                <span className="inline-flex items-center gap-3">
                  <PrayerIcon prayer={prayer.prayer} size={22} className="text-primary-700" />
                  {jumuah ? name('jumuah') : name(prayer.prayer)}
                </span>
              </th>
              <td className="text-end tabular-nums">
                <Bdi>{time(prayer.adhan)}</Bdi>
              </td>
              <td className="text-end font-semibold tabular-nums">
                <Bdi>{time(jumuah ? firstJumuah.jamaatTime : prayer.jamaat)}</Bdi>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
