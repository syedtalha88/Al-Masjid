// A6 Prayer Timings content (07 A6, ref-1/4, 08 §5.5) — the A6 screen and Masjid Detail's "Prayer Timings" tab: date
// stepper (−7 … +60 days, date sheet, Hijri under the pill), tabs Daily Timings · Jumu'ah · Special Dates. Changing the
// day slides the table in from the side it comes from (mirrored in RTL; a fade with reduced motion).
import { effectiveHijriOffset, toHijri } from '@mc/domain/hijri';
import { nextJamaat, resolveSchedule } from '@mc/domain/prayer';
import { addDays, calendarDateInZone, compareCalendarDates } from '@mc/domain/time';
import { directionOf } from '@mc/i18n/locales';
import { Bdi, useHijriLabel, useLocale, useTranslation } from '@mc/i18n/react';
import type { ActiveMasjidBundle } from '@mc/shared/contracts/public';
import {
  DatePickerSheet,
  DateStepper,
  IconCircle,
  InfoNote,
  JumuahCard,
  PrayerTable,
  TabPanels,
  UnderlineTabs,
  usePrayerName,
} from '@mc/ui/components';
import { CrescentIcon, PrayerIcon } from '@mc/ui/icons';
import { crossfadeIn, slideIn, useMotionPrefs } from '@mc/ui/motion';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { configQuery } from '../../../lib/api/queries.ts';
import { useAppData } from '../../../lib/data.tsx';
import { scheduleOf } from '../../home/lib/home-view.ts';
import { clampToRange, nextRowKey, timingRows, TIMINGS_RANGE, upcomingSpecials } from '../lib/timings-view.ts';

type TabId = 'daily' | 'jumuah' | 'special';

export function TimingsContent({ bundle, now }: { readonly bundle: ActiveMasjidBundle; readonly now: Date }) {
  const { t } = useTranslation('masjid');
  const { t: tc } = useTranslation();
  const { format, locale } = useLocale();
  const rtl = directionOf(locale) === 'rtl';
  const hijriLabel = useHijriLabel();
  const prayerName = usePrayerName();
  const { reduced } = useMotionPrefs();
  const { api } = useAppData();
  const config = useQuery(configQuery(api));
  const today = calendarDateInZone(now);
  const [date, setDate] = useState(today);
  const [tab, setTab] = useState<TabId>('daily');
  const [picking, setPicking] = useState(false);
  const table = useRef<HTMLDivElement>(null);
  const shown = useRef(date);

  const schedule = useMemo(() => scheduleOf(bundle), [bundle]);
  const day = useMemo(() => (schedule ? resolveSchedule(schedule, date) : null), [schedule, date]);
  const next = useMemo(
    () =>
      schedule ? nextJamaat(resolveSchedule(schedule, today), resolveSchedule(schedule, addDays(today, 1)), now) : null,
    [schedule, today, now],
  );

  // Directional slide when the day changes (08 §5.5).
  useEffect(() => {
    const node = table.current;
    const previous = shown.current;
    shown.current = date;
    if (!node || previous === date) return;
    const forward = compareCalendarDates(date, previous) > 0;
    const effect = reduced ? crossfadeIn(node) : slideIn(node, ((forward ? 1 : -1) * (rtl ? -1 : 1)) as 1 | -1);
    return () => {
      effect.stop();
    };
  }, [date, reduced, rtl]);

  const first = addDays(today, -TIMINGS_RANGE.before);
  const last = addDays(today, TIMINGS_RANGE.after);
  const medium = format.calendarDate(date, 'medium');
  const label = date === today ? t('todayDate', { date: medium }) : medium;
  const hijri = toHijri(date, effectiveHijriOffset(bundle.masjid.hijriOffset, config.data?.globalHijriOffset ?? 0));
  const highlighted = nextRowKey(next, date);
  const tabs = [
    { id: 'daily' as const, label: t('daily') },
    { id: 'jumuah' as const, label: prayerName('jumuah') },
    { id: 'special' as const, label: t('specialDates') },
  ];
  const specials = upcomingSpecials(bundle.specialDates, today);

  return (
    <div className="flex flex-col gap-4">
      <DateStepper
        label={label}
        {...(hijri ? { sublabel: hijriLabel(hijri) } : {})}
        prevLabel={t('prevDay')}
        nextLabel={t('nextDay')}
        pickLabel={`${t('pickDate')}, ${label}`}
        prevDisabled={date === first}
        nextDisabled={date === last}
        onPrev={() => {
          setDate(clampToRange(addDays(date, -1), today));
        }}
        onNext={() => {
          setDate(clampToRange(addDays(date, 1), today));
        }}
        onPick={() => {
          setPicking(true);
        }}
      />
      <UnderlineTabs label={t('timingsTabs')} idPrefix="timings-tab" tabs={tabs} value={tab} onChange={setTab} />
      <TabPanels idPrefix="timings-tab" tabs={tabs} value={tab} onChange={setTab}>
        {(id) => {
          if (!day) return <InfoNote>{tc('home.noTimings')}</InfoNote>;
          if (id === 'daily') {
            return (
              <div className="flex flex-col gap-4">
                <div ref={table}>
                  <PrayerTable
                    caption={format.calendarDate(date, 'long')}
                    adhanLabel={t('adhan')}
                    jamaatLabel={t('jamaat')}
                    calculatedLabel={t('calculated')}
                    rows={timingRows(day).map((row) => ({
                      key: row.key,
                      label: row.key === 'sunrise' ? t('sunrise') : prayerName(row.key),
                      icon: (
                        <PrayerIcon
                          prayer={row.key === 'sunrise' ? 'fajr' : row.key === 'jumuah' ? 'dhuhr' : row.key}
                          size={22}
                        />
                      ),
                      adhan: row.adhan,
                      adhanCalculated: row.adhanCalculated,
                      jamaat: row.jamaat,
                      muted: row.muted,
                      highlighted: row.key === highlighted,
                    }))}
                  />
                </div>
                <InfoNote>{t('note')}</InfoNote>
              </div>
            );
          }
          if (id === 'jumuah') {
            return day.jumuah.length > 0 ? (
              <JumuahCard
                title={t('jumuahTimings')}
                rows={day.jumuah.map((jumuah) => ({
                  label: t('jumuahN', { n: jumuah.seq }),
                  time: jumuah.jamaatTime,
                  khutbah: jumuah.khutbahTime,
                }))}
              />
            ) : (
              <p className="type-callout text-text-secondary">{t('noJumuah')}</p>
            );
          }
          return specials.length > 0 ? (
            <ul className="flex flex-col gap-4">
              {specials.map((group) => (
                <li key={group.date} className="flex flex-col gap-2">
                  <h3 className="type-subhead-strong text-text-secondary">{format.calendarDate(group.date, 'long')}</h3>
                  {group.items.map((special) => (
                    <div key={special.id} className="flex items-start gap-3 rounded-lg bg-surface p-3 shadow-e1">
                      <IconCircle tone="primary" size={44}>
                        <CrescentIcon />
                      </IconCircle>
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <p className="type-headline text-text">
                          {t(`special.${special.type}`)}
                          {special.label ? (
                            <span className="type-callout text-text-secondary"> · {special.label}</span>
                          ) : null}
                        </p>
                        <p className="flex flex-wrap gap-1.5">
                          {special.times.map((entry) => (
                            <span
                              key={`${entry.time}-${entry.label ?? ''}`}
                              className="rounded-full bg-mint-50 px-3 py-1 type-caption text-primary-800"
                            >
                              <Bdi>{format.time(entry.time).text}</Bdi>
                              {entry.label ? ` · ${entry.label}` : ''}
                            </span>
                          ))}
                        </p>
                        {special.note ? <p className="type-footnote text-text-secondary">{special.note}</p> : null}
                      </div>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <p className="type-callout text-text-secondary">{t('noSpecial')}</p>
          );
        }}
      </TabPanels>
      <DatePickerSheet
        open={picking}
        onClose={() => {
          setPicking(false);
        }}
        title={t('pickDate')}
        value={date}
        min={first}
        max={last}
        today={today}
        onChange={(value) => {
          setDate(clampToRange(value, today));
          setPicking(false);
        }}
      />
    </div>
  );
}
