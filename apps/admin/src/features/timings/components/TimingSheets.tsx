// The B4 pickers (07 B4): a time wheel, and the adhan / jamaat sheets — big segmented modes, a wheel or a ±1 minute
// stepper, and today's resulting time resolved by `@mc/domain` so the admin sees the effect before tapping Done.
import type { PrayerConfig } from '@mc/domain/prayer';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { Button, IconButton, SegmentedControl, Sheet, TimeWheel } from '@mc/ui/components';
import { MinusIcon, PlusIcon } from '@mc/ui/icons';
import { useState } from 'react';

import { ADJUST_RANGE, OFFSET_RANGE } from '../lib/editor.ts';
import { ltr } from '../lib/text.ts';

/** One-tap jamaat gaps after the adhan (minutes) — the common ones; any other value through the stepper. */
const QUICK_OFFSETS = [5, 10, 15, 20, 30] as const;

const clamp = (value: number, range: { readonly min: number; readonly max: number }) =>
  Math.min(Math.max(value, range.min), range.max);

/** A ±1 stepper with 56px buttons (admin targets) and the value read out between them. */
export function Stepper({
  value,
  text,
  onChange,
  range,
  lessLabel,
  moreLabel,
}: {
  readonly value: number;
  readonly text: string;
  readonly onChange: (value: number) => void;
  readonly range: { readonly min: number; readonly max: number };
  readonly lessLabel: string;
  readonly moreLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <IconButton
        label={lessLabel}
        icon={<MinusIcon size={24} />}
        variant="tinted"
        disabled={value <= range.min}
        onPress={() => {
          onChange(clamp(value - 1, range));
        }}
      />
      <output aria-live="polite" className="type-headline text-text tabular-nums">
        {text}
      </output>
      <IconButton
        label={moreLabel}
        icon={<PlusIcon size={24} />}
        variant="tinted"
        disabled={value >= range.max}
        onPress={() => {
          onChange(clamp(value + 1, range));
        }}
      />
    </div>
  );
}

export interface TimeSheetProps {
  readonly open: boolean;
  readonly title: string;
  readonly value: string;
  readonly onDone: (value: string) => void;
  readonly onClose: () => void;
  /** Offers "No khutbah time" (clears the value). */
  readonly clearLabel?: string;
  readonly onClear?: () => void;
}

/** One time on a wheel (Jumu'ah jamaat, khutbah). */
export function TimeSheet({ open, title, value, onDone, onClose, clearLabel, onClear }: TimeSheetProps) {
  const { t } = useTranslation('admin');
  const [time, setTime] = useState(value);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            fullWidth
            onPress={() => {
              onDone(time);
            }}
          >
            {t('timings.done')}
          </Button>
          {clearLabel && onClear ? (
            <Button size="lg" variant="ghost" fullWidth onPress={onClear}>
              {clearLabel}
            </Button>
          ) : null}
        </div>
      }
    >
      <TimeWheel label={title} value={time} onChange={setTime} />
    </Sheet>
  );
}

export interface TimeRangeSheetProps {
  readonly open: boolean;
  readonly title: string;
  readonly value: { readonly start: string; readonly end: string };
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly onDone: (value: { start: string; end: string }) => void;
  readonly onClose: () => void;
}

/**
 * A time range on two wheels in one sheet (07 B5 "time range → two wheels"): both ends with one Done, so "No water
 * 10–2" stays within 6 taps (PHASE_03 T3.12).
 */
export function TimeRangeSheet({ open, title, value, fromLabel, toLabel, onDone, onClose }: TimeRangeSheetProps) {
  const { t } = useTranslation('admin');
  const [range, setRange] = useState(value);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <Button
          size="lg"
          fullWidth
          onPress={() => {
            onDone(range);
          }}
        >
          {t('timings.done')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <section className="flex flex-col gap-1" aria-label={fromLabel}>
          <h3 className="type-subhead-strong text-text-secondary">{fromLabel}</h3>
          <TimeWheel
            label={`${title} · ${fromLabel}`}
            value={range.start}
            onChange={(start) => {
              setRange((current) => ({ ...current, start }));
            }}
          />
        </section>
        <section className="flex flex-col gap-1" aria-label={toLabel}>
          <h3 className="type-subhead-strong text-text-secondary">{toLabel}</h3>
          <TimeWheel
            label={`${title} · ${toLabel}`}
            value={range.end}
            onChange={(end) => {
              setRange((current) => ({ ...current, end }));
            }}
          />
        </section>
      </div>
    </Sheet>
  );
}

export interface PrayerSheetProps {
  readonly open: boolean;
  readonly title: string;
  readonly config: PrayerConfig;
  /** Today's times with a candidate config (resolved by the domain). */
  readonly resolve: (config: PrayerConfig) => { readonly adhan: string; readonly jamaat: string | null };
  readonly onDone: (config: PrayerConfig) => void;
  readonly onClose: () => void;
}

/** Adhan: calculated (± minutes) or a time the admin sets. */
export function AdhanSheet({ open, title, config, resolve, onDone, onClose }: PrayerSheetProps) {
  const { t } = useTranslation('admin');
  const { format } = useLocale();
  const [draft, setDraft] = useState(config);
  const today = resolve(draft);
  const adjust = draft.adhanAdjustMin ?? 0;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <Button
          size="lg"
          fullWidth
          onPress={() => {
            onDone(draft);
          }}
        >
          {t('timings.done')}
        </Button>
      }
    >
      <div className="flex flex-col gap-5 pb-2">
        <SegmentedControl
          label={t('timings.modeLabel')}
          segments={[
            { id: 'auto', label: t('timings.modeAuto') },
            { id: 'manual', label: t('timings.modeManual') },
          ]}
          value={draft.adhanMode}
          onChange={(mode) => {
            setDraft(
              mode === 'manual'
                ? { ...draft, adhanMode: 'manual', adhanTime: draft.adhanTime ?? today.adhan }
                : { ...draft, adhanMode: 'auto' },
            );
          }}
        />
        {draft.adhanMode === 'auto' ? (
          <div className="flex flex-col gap-2">
            <p className="type-callout text-text-secondary">{t('timings.adjust')}</p>
            <Stepper
              value={adjust}
              range={ADJUST_RANGE}
              text={
                adjust === 0
                  ? t('timings.asCalculated')
                  : adjust > 0
                    ? t('timings.later', { minutes: adjust })
                    : t('timings.earlier', { minutes: -adjust })
              }
              lessLabel={t('timings.oneEarlier')}
              moreLabel={t('timings.oneLater')}
              onChange={(value) => {
                setDraft({ ...draft, adhanAdjustMin: value });
              }}
            />
          </div>
        ) : (
          <TimeWheel
            label={title}
            value={draft.adhanTime ?? today.adhan}
            onChange={(value) => {
              setDraft({ ...draft, adhanTime: value });
            }}
          />
        )}
        <p className="type-callout text-text">{t('timings.today', { time: ltr(format.time(today.adhan).text) })}</p>
      </div>
    </Sheet>
  );
}

/** Jamaat: a fixed time, or N minutes after the adhan (Maghrib's time moves every day). */
export function JamaatSheet({ open, title, config, resolve, onDone, onClose }: PrayerSheetProps) {
  const { t } = useTranslation('admin');
  const { format } = useLocale();
  const [draft, setDraft] = useState<PrayerConfig>(
    config.jamaatMode === 'none' ? { ...config, jamaatMode: 'offset', jamaatOffsetMin: 10 } : config,
  );
  const today = resolve(draft);
  const offset = draft.jamaatOffsetMin ?? 0;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <Button
          size="lg"
          fullWidth
          onPress={() => {
            onDone(draft);
          }}
        >
          {t('timings.done')}
        </Button>
      }
    >
      <div className="flex flex-col gap-5 pb-2">
        <SegmentedControl
          label={t('timings.modeLabel')}
          segments={[
            { id: 'fixed', label: t('timings.modeFixed') },
            { id: 'offset', label: t('timings.modeOffset') },
          ]}
          value={draft.jamaatMode === 'fixed' ? 'fixed' : 'offset'}
          onChange={(mode) => {
            setDraft(
              mode === 'fixed'
                ? { ...draft, jamaatMode: 'fixed', jamaatTime: draft.jamaatTime ?? today.jamaat ?? today.adhan }
                : { ...draft, jamaatMode: 'offset', jamaatOffsetMin: draft.jamaatOffsetMin ?? 10 },
            );
          }}
        />
        {draft.jamaatMode === 'fixed' ? (
          <TimeWheel
            label={title}
            value={draft.jamaatTime ?? today.adhan}
            onChange={(value) => {
              setDraft({ ...draft, jamaatTime: value });
            }}
          />
        ) : (
          <>
            <Stepper
              value={offset}
              range={OFFSET_RANGE}
              text={t('timings.offsetValue', { minutes: offset })}
              lessLabel={t('timings.oneLess')}
              moreLabel={t('timings.oneMore')}
              onChange={(value) => {
                setDraft({ ...draft, jamaatOffsetMin: value });
              }}
            />
            {/* The usual gaps in one tap (T3.12: a jamaat change in ≤ 6 taps); the stepper fine-tunes. */}
            <div role="group" aria-label={t('timings.quickOffsets')} className="grid grid-cols-5 gap-2">
              {QUICK_OFFSETS.map((minutes) => (
                <Button
                  key={minutes}
                  variant={minutes === offset ? 'primary' : 'outline'}
                  className="px-0"
                  aria-pressed={minutes === offset}
                  aria-label={t('timings.offsetValue', { minutes })}
                  onPress={() => {
                    setDraft({ ...draft, jamaatOffsetMin: minutes });
                  }}
                >
                  {format.number(minutes)}
                </Button>
              ))}
            </div>
          </>
        )}
        {today.jamaat ? (
          <p className="type-callout text-text">{t('timings.today', { time: ltr(format.time(today.jamaat).text) })}</p>
        ) : null}
      </div>
    </Sheet>
  );
}
