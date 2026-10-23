// Prayer Timings components (06 §6 Content, ref-1/4): DateStepper (prev/next + date pill, Hijri under it), PrayerTable
// (Adhan + Jamaat columns, muted Sunrise row, "calculated" dots, next row tinted) and JumuahCard. Presentational: the
// screen passes formatted labels and decides which row is next.
import { Bdi, useLocale, useTranslation } from '@mc/i18n/react';
import type { ReactNode } from 'react';

import { CalendarIcon, CaretLeftIcon, CaretRightIcon } from '../icons/glyphs.tsx';
import { MosqueIllustration } from '../illustrations/Illustrations.tsx';
import { DigitRoll } from '../motion/DigitRoll.tsx';
import { Pressable } from '../motion/Pressable.tsx';
import { IconButton } from './Button.tsx';

export interface DateStepperProps {
  /** "Today, 8 Oct 2026". */
  readonly label: string;
  /** The Hijri date, small under the pill. */
  readonly sublabel?: string;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly prevDisabled?: boolean;
  readonly nextDisabled?: boolean;
  /** Tapping the pill (opens the date sheet). */
  readonly onPick: () => void;
  readonly prevLabel: string;
  readonly nextLabel: string;
  /** Accessible name of the pill, e.g. "Choose a date, Today, 8 Oct 2026". */
  readonly pickLabel: string;
}

/** 40px round arrows around a pill with the calendar icon; the date text rolls when it changes (08 §5.5). */
export function DateStepper({
  label,
  sublabel,
  onPrev,
  onNext,
  prevDisabled = false,
  nextDisabled = false,
  onPick,
  prevLabel,
  nextLabel,
  pickLabel,
}: DateStepperProps) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex w-full items-center justify-between gap-2">
        <IconButton
          label={prevLabel}
          variant="tinted"
          icon={<CaretLeftIcon className="rtl:-scale-x-100" />}
          disabled={prevDisabled}
          onPress={onPrev}
        />
        <Pressable
          onPress={onPick}
          aria-label={pickLabel}
          className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-full bg-surface px-4 type-subhead-strong text-text shadow-e1"
        >
          <CalendarIcon size={18} className="shrink-0 text-primary-700" />
          <DigitRoll text={label} className="truncate" />
        </Pressable>
        <IconButton
          label={nextLabel}
          variant="tinted"
          icon={<CaretRightIcon className="rtl:-scale-x-100" />}
          disabled={nextDisabled}
          onPress={onNext}
        />
      </div>
      {sublabel ? <p className="type-caption text-text-secondary">{sublabel}</p> : null}
    </div>
  );
}

export interface PrayerTableRow {
  readonly key: string;
  readonly label: string;
  readonly icon: ReactNode;
  /** "HH:mm". */
  readonly adhan: string;
  readonly adhanCalculated: boolean;
  /** "HH:mm", or `null` ("–", or nothing for a muted row). */
  readonly jamaat: string | null;
  readonly muted?: boolean;
  readonly highlighted?: boolean;
}

export interface PrayerTableProps {
  readonly rows: readonly PrayerTableRow[];
  readonly adhanLabel: string;
  readonly jamaatLabel: string;
  /** Spoken after a calculated time and the dot's tooltip ("Calculated for this masjid's location"). */
  readonly calculatedLabel: string;
  /** The date, for screen readers. */
  readonly caption: string;
}

/** Header row on surface-muted; rows: icon + name, Adhan, Jamaat (bold); the next row tinted mint (06 §6). */
export function PrayerTable({ rows, adhanLabel, jamaatLabel, calculatedLabel, caption }: PrayerTableProps) {
  const { format } = useLocale();
  const time = (value: string) => <Bdi>{format.time(value).text}</Bdi>;
  return (
    <table className="w-full border-separate border-spacing-0">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="type-caption text-text-secondary">
          <td className="rounded-s-md bg-surface-muted py-2" />
          <th scope="col" className="bg-surface-muted py-2 text-end font-medium">
            {adhanLabel}
          </th>
          <th scope="col" className="rounded-e-md bg-surface-muted py-2 pe-3 text-end font-medium">
            {jamaatLabel}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const tint = row.highlighted ? 'bg-mint-50' : '';
          return (
            <tr
              key={row.key}
              aria-current={row.highlighted ? 'time' : undefined}
              className={row.muted ? 'text-text-secondary' : 'text-text'}
            >
              <th scope="row" className={`rounded-s-md py-3 ps-3 text-start font-normal ${tint}`}>
                <span className={`inline-flex items-center gap-3 ${row.muted ? 'type-callout' : 'type-body'}`}>
                  <span aria-hidden className={row.muted ? 'text-text-tertiary' : 'text-primary-700'}>
                    {row.icon}
                  </span>
                  {row.label}
                </span>
              </th>
              <td className={`py-3 text-end tabular-nums ${row.muted ? 'type-callout' : 'type-body'} ${tint}`}>
                <span className="inline-flex items-center gap-1.5">
                  {time(row.adhan)}
                  {row.adhanCalculated && !row.muted ? (
                    <span title={calculatedLabel} className="inline-flex">
                      <span aria-hidden className="size-1.5 rounded-full bg-primary-500" />
                      <span className="sr-only">{calculatedLabel}</span>
                    </span>
                  ) : (
                    <span aria-hidden className="size-1.5" />
                  )}
                </span>
              </td>
              <td className={`rounded-e-md py-3 pe-3 text-end type-headline tabular-nums ${tint}`}>
                {row.muted ? null : row.jamaat ? time(row.jamaat) : '–'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export interface JumuahCardProps {
  readonly title: string;
  /** "Jumu'ah 1" + jamaat time + optional khutbah line. */
  readonly rows: readonly { readonly label: string; readonly time: string; readonly khutbah?: string | undefined }[];
}

/** Mint card with a small mosque illustration and each Jumu'ah jamaat (06 §6 JumuahCard). */
export function JumuahCard({ title, rows }: JumuahCardProps) {
  const { format } = useLocale();
  const { t } = useTranslation();
  return (
    <section className="flex items-center gap-4 rounded-lg bg-mint-50 p-4">
      <MosqueIllustration width={64} className="shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="type-headline text-primary-900">{title}</h3>
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li key={row.label} className="flex flex-col">
              <span className="flex items-baseline justify-between gap-3 type-body text-text">
                <span>{row.label}</span>
                <span className="type-subhead-strong tabular-nums">
                  <Bdi>{format.time(row.time).text}</Bdi>
                </span>
              </span>
              {row.khutbah ? (
                <span className="type-caption text-text-secondary">
                  {t('ui.khutbah', { time: format.time(row.khutbah).text })}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
