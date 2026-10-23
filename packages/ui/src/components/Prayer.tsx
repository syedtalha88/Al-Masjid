// Prayer components (06 §6 Content, 08 §5.5): NextPrayerPanel (mint panel: next jamaat + countdown), PrayerStrip (five
// jamaat cells with a highlight that slides to the next prayer) and CountdownText. Presentational: the caller resolves
// times and the countdown with @mc/domain (DECISIONS #15 — jamaat times; Friday Dhuhr = Jumu'ah).
import type { Countdown } from '@mc/domain/countdown';
import { Bdi, useLocale, useTranslation } from '@mc/i18n/react';
import type { CSSProperties, ReactNode } from 'react';

import { CaretRightIcon } from '../icons/glyphs.tsx';
import { type Prayer, PrayerIcon } from '../icons/PrayerIcon.tsx';
import { DigitRoll } from '../motion/DigitRoll.tsx';
import { Pressable } from '../motion/Pressable.tsx';

/** A strip cell / panel prayer: the five, or Jumu'ah in Friday's Dhuhr slot. */
export type PrayerSlotName = Prayer | 'jumuah';

const iconOf = (prayer: PrayerSlotName): Prayer => (prayer === 'jumuah' ? 'dhuhr' : prayer);

/** The localized prayer name ("Fajr", "Jumu'ah"). */
export function usePrayerName(): (prayer: PrayerSlotName) => string {
  const { t } = useTranslation();
  return (prayer) => t(`prayer.${prayer}`);
}

/** "2h 18m left" · "48m left" · "Starts in 8 min" · "Jamaat now" (07 A2); empty once past. */
export function useCountdownText(): (value: Countdown) => string {
  const { t } = useTranslation();
  return (value) => {
    switch (value.kind) {
      case 'left':
        return value.hours > 0
          ? t('countdown.hoursMinutes', { hours: value.hours, minutes: value.minutes })
          : t('countdown.minutes', { minutes: value.minutes });
      case 'soon':
        return t('countdown.soon', { minutes: value.minutes });
      case 'now':
        return t('countdown.now');
      case 'past':
        return '';
    }
  };
}

/**
 * Countdown text (08 §5.5): changed digits roll; under 10 minutes (and at "Jamaat now") it turns primary-700 bold
 * with a soft pulsing dot (static with reduced motion). The parent re-renders it once a minute.
 */
export function CountdownText({ value, className }: { readonly value: Countdown; readonly className?: string }) {
  const text = useCountdownText()(value);
  const urgent = value.kind === 'soon' || value.kind === 'now';
  return (
    <span
      className={`inline-flex items-center gap-1.5 transition-state ${
        urgent ? 'type-subhead-strong text-primary-700' : 'type-footnote text-text-secondary'
      } ${className ?? ''}`}
    >
      {urgent ? <span aria-hidden className="pulse-dot size-1.5 rounded-full bg-primary-600" /> : null}
      <DigitRoll text={text} />
    </span>
  );
}

export interface NextPrayerPanelProps {
  /** The next jamaat's prayer, or `null` when the masjid holds none (shows `emptyText`). */
  readonly prayer: PrayerSlotName | null;
  readonly countdown: Countdown | null;
  /** Shown instead of a prayer (no timings yet / no jamaat). */
  readonly emptyText?: string;
  /** Pressable with a chevron (opens the timings) when set. */
  readonly onPress?: () => void;
  readonly className?: string;
}

/** Mint panel (06 §6): prayer icon in sun colour, "Next Prayer", prayer name `title2`, countdown, chevron. */
export function NextPrayerPanel({ prayer, countdown, emptyText, onPress, className }: NextPrayerPanelProps) {
  const { t } = useTranslation();
  const name = usePrayerName();
  const body: ReactNode = (
    <>
      <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center text-sun">
        <PrayerIcon prayer={iconOf(prayer ?? 'dhuhr')} size={30} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col items-start text-start">
        <span className="type-caption text-text-secondary">{t('ui.nextPrayer')}</span>
        {prayer ? (
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="type-title2 text-primary-900">{name(prayer)}</span>
            {countdown ? <CountdownText value={countdown} /> : null}
          </span>
        ) : (
          <span className="type-callout text-text-secondary">{emptyText}</span>
        )}
      </span>
      {onPress ? <CaretRightIcon size={20} className="shrink-0 text-text-secondary rtl:-scale-x-100" /> : null}
    </>
  );
  const box = `flex w-full items-center gap-3 rounded-lg bg-mint-50 px-4 py-3 ${className ?? ''}`;
  return onPress ? (
    <Pressable kind="card" onPress={onPress} className={box}>
      {body}
    </Pressable>
  ) : (
    <div className={box}>{body}</div>
  );
}

export interface PrayerStripSlot {
  readonly prayer: PrayerSlotName;
  /** Jamaat "HH:mm", or `null` when none is held ("—"). */
  readonly time: string | null;
}

export interface PrayerStripProps {
  readonly slots: readonly PrayerStripSlot[];
  /** Highlighted cell (the next jamaat), or `null`. */
  readonly activeIndex: number | null;
  /** Accessible name of the list, e.g. "Jamaat times, Thursday 22 October". */
  readonly label: string;
  readonly className?: string;
}

/**
 * Five equal cells: name `caption`, time `time-large`, AM/PM `micro` (06 §6). The mint highlight is one element that
 * slides between cells (transform only — 08 §5.5); RTL slides the other way.
 */
export function PrayerStrip({ slots, activeIndex, label, className }: PrayerStripProps) {
  const name = usePrayerName();
  const { format } = useLocale();
  const count = Math.max(slots.length, 1);
  // CSSProperties has no index signature for custom properties.
  const highlight: CSSProperties & Record<'--mc-index', number> = {
    '--mc-index': activeIndex ?? 0,
    width: `${String(100 / count)}%`,
  };
  return (
    <div className={`relative ${className ?? ''}`}>
      {activeIndex === null ? null : (
        <span
          aria-hidden
          data-strip-highlight
          className="absolute inset-y-0 start-0 rounded-md bg-mint-100 transition-highlight [transform:translateX(calc(var(--mc-index)*100%))] rtl:[transform:translateX(calc(var(--mc-index)*-100%))]"
          style={highlight}
        />
      )}
      <ol aria-label={label} className="relative grid" style={{ gridTemplateColumns: `repeat(${String(count)}, 1fr)` }}>
        {slots.map((slot, index) => {
          const time = slot.time === null ? null : format.time(slot.time);
          return (
            <li
              key={`${slot.prayer}-${String(index)}`}
              aria-current={index === activeIndex ? 'time' : undefined}
              className="flex flex-col items-center gap-0.5 py-2"
            >
              <span className="type-caption text-text-secondary">{name(slot.prayer)}</span>
              {time ? (
                <>
                  <span className={`type-time-large ${index === activeIndex ? 'text-primary-800' : 'text-text'}`}>
                    <Bdi>{time.time}</Bdi>
                  </span>
                  <span className="type-micro text-text-secondary">{time.period}</span>
                </>
              ) : (
                <span className="type-time-large text-text-tertiary">–</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
