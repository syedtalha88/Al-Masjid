// One day of a masjid's prayer times as the musalli A6 screen shows them (07 A6, ref-1/4): the table rows straight from
// `@mc/domain` (Sunrise as a muted row, Jumu'ah in Dhuhr's place on Fridays) and the note under it. Shared by the
// musalli app and the admin timings preview (T3.2 — the preview renders exactly this, never a copy).
import type { PrayerName, ResolvedDay } from '@mc/domain/prayer';
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { Ref } from 'react';

import { InfoNote } from '../components/InfoNote.tsx';
import { usePrayerName } from '../components/Prayer.tsx';
import { PrayerTable } from '../components/Timings.tsx';
import { PrayerIcon } from '../icons/PrayerIcon.tsx';

export type TimingRowKey = PrayerName | 'sunrise' | 'jumuah';

export interface TimingRow {
  readonly key: TimingRowKey;
  /** "HH:mm". */
  readonly adhan: string;
  /** Calculated for the masjid's location (the table shows a small dot). */
  readonly adhanCalculated: boolean;
  /** "HH:mm", or `null` (Sunrise, or no jamaat held). */
  readonly jamaat: string | null;
  /** Sunrise: shown muted, Adhan column only. */
  readonly muted: boolean;
}

/** The rows of `day`: Fajr, Sunrise, Dhuhr (Jumu'ah on Fridays: first jamaat), Asr, Maghrib, Isha. */
export function timingRows(day: ResolvedDay): TimingRow[] {
  return day.prayers.flatMap((prayer): TimingRow[] => {
    const row: TimingRow = {
      key: prayer.prayer,
      adhan: prayer.adhan,
      adhanCalculated: prayer.adhanCalculated,
      jamaat: prayer.jamaat,
      muted: false,
    };
    if (prayer.prayer === 'fajr') {
      return [row, { key: 'sunrise', adhan: day.sunrise, adhanCalculated: true, jamaat: null, muted: true }];
    }
    const jumuah = day.jumuah[0];
    if (prayer.prayer === 'dhuhr' && day.isFriday && jumuah) {
      return [{ ...row, key: 'jumuah', jamaat: jumuah.jamaatTime }];
    }
    return [row];
  });
}

export interface DayTimingsProps {
  readonly day: ResolvedDay;
  /** "YYYY-MM-DD" — the table's caption. */
  readonly date: string;
  /** The row tinted as the next jamaat, if it is on this day. */
  readonly highlighted: TimingRowKey | null;
  /** The table's wrapper (the musalli screen slides it when the day changes). */
  readonly tableRef?: Ref<HTMLDivElement>;
}

/** A6 "Daily Timings": the day's table and the note under it (needs the `masjid` namespace). */
export function DayTimings({ day, date, highlighted, tableRef }: DayTimingsProps) {
  const { t } = useTranslation('masjid');
  const { format } = useLocale();
  const prayerName = usePrayerName();
  return (
    <div className="flex flex-col gap-4">
      <div ref={tableRef}>
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
