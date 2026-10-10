import {
  addDays,
  addMonths,
  calendarDateInZone,
  compareCalendarDates,
  monthGrid,
  parseCalendarDate,
  toCalendarDate,
} from '@mc/domain/time';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { type KeyboardEvent, useId, useRef, useState } from 'react';

import { CaretDownIcon, CaretLeftIcon, CaretRightIcon, CheckIcon } from '../icons/glyphs.tsx';
import { Pressable } from '../motion/Pressable.tsx';
import { IconButton } from './Button.tsx';
import { Sheet } from './Sheet.tsx';

export interface SelectOption<Value extends string = string> {
  readonly value: Value;
  readonly label: string;
  readonly description?: string;
}

export interface SelectProps<Value extends string> {
  /** Visible field label; also the sheet title. */
  readonly label: string;
  readonly options: readonly SelectOption<Value>[];
  readonly value: Value | null;
  readonly onChange: (value: Value) => void;
  /** Shown when nothing is chosen (default "Choose"). */
  readonly placeholder?: string;
  readonly className?: string;
}

/**
 * Select (06 §6): a field-styled button showing the current choice; it opens a Sheet with the options as a
 * radio group. Choosing one closes the sheet. Big targets, no tiny native dropdown.
 */
export function Select<Value extends string>({
  label,
  options,
  value,
  onChange,
  placeholder,
  className,
}: SelectProps<Value>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const current = options.find((option) => option.value === value);
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <span id={labelId} className="type-subhead-strong text-text">
        {label}
      </span>
      <Pressable
        aria-haspopup="dialog"
        aria-labelledby={`${labelId} ${labelId}-value`}
        onPress={() => {
          setOpen(true);
        }}
        className="flex min-h-(--mc-control-md) w-full items-center gap-2 rounded-sm border border-border bg-surface px-4 text-start data-[pressed]:bg-surface-muted"
      >
        <span
          id={`${labelId}-value`}
          className={`min-w-0 flex-1 truncate type-body ${current ? 'text-text' : 'text-text-tertiary'}`}
        >
          {current?.label ?? placeholder ?? t('ui.choose')}
        </span>
        <CaretDownIcon size={18} className="shrink-0 text-text-tertiary" />
      </Pressable>
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={label}
      >
        <div role="radiogroup" aria-label={label} className="flex flex-col">
          {options.map((option) => {
            const checked = option.value === value;
            return (
              <Pressable
                key={option.value}
                role="radio"
                aria-checked={checked}
                kind="card"
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className="flex min-h-14 w-full items-center gap-3 rounded-sm px-2 text-start data-[pressed]:bg-surface-muted"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={`type-body ${checked ? 'font-semibold text-primary-700' : 'text-text'}`}>
                    {option.label}
                  </span>
                  {option.description ? (
                    <span className="type-footnote text-text-secondary">{option.description}</span>
                  ) : null}
                </span>
                {checked ? <CheckIcon size={20} className="shrink-0 text-primary-700" /> : null}
              </Pressable>
            );
          })}
        </div>
      </Sheet>
    </div>
  );
}

export interface DatePickerSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Sheet title ("Choose date"). */
  readonly title: string;
  /** Selected calendar date "YYYY-MM-DD", or null. */
  readonly value: string | null;
  /** Called with the chosen date; the sheet then closes itself via `onClose`. */
  readonly onChange: (value: string) => void;
  /** Earliest / latest selectable dates (inclusive). */
  readonly min?: string;
  readonly max?: string;
  /** "Today" in IST — injectable for tests (default: now). */
  readonly today?: string;
}

const inRange = (date: string, min?: string, max?: string) =>
  (min === undefined || compareCalendarDates(date, min) >= 0) &&
  (max === undefined || compareCalendarDates(date, max) <= 0);

/**
 * Month calendar in a sheet (06 §6 DatePickerSheet): month title with previous/next, weekday header,
 * 7-column grid with Latin digits; today outlined, selection filled primary-700. Keyboard: arrows move a day
 * (mirrored in RTL) or a week, PageUp/PageDown a month, Enter/Space picks. Each day button is named with the
 * full spoken date; days outside min/max are disabled.
 */
export function DatePickerSheet({ open, onClose, title, value, onChange, min, max, today }: DatePickerSheetProps) {
  const { t } = useTranslation();
  const { format } = useLocale();
  const todayDate = today ?? calendarDateInZone(new Date());
  const [focus, setFocus] = useState(value ?? todayDate);
  // Each time the sheet opens, start at the selected date (or today).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setFocus(value ?? todayDate);
  }
  const grid = useRef<HTMLDivElement>(null);
  const { year, month } = parseCalendarDate(focus);
  const cells = monthGrid(year, month, 0);
  const monthStart = toCalendarDate(year, month, 1);

  const moveFocus = (next: string) => {
    setFocus(next);
    // Focus after React renders the (possibly new) month.
    requestAnimationFrame(() => {
      grid.current?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus();
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const steps: Record<string, () => string> = {
      ArrowRight: () => addDays(focus, rtl ? -1 : 1),
      ArrowLeft: () => addDays(focus, rtl ? 1 : -1),
      ArrowDown: () => addDays(focus, 7),
      ArrowUp: () => addDays(focus, -7),
      PageDown: () => addMonths(focus, 1),
      PageUp: () => addMonths(focus, -1),
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    moveFocus(step());
  };

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="flex items-center justify-between pb-2">
        <IconButton
          label={t('ui.previousMonth')}
          icon={<CaretLeftIcon size={20} className="rtl:-scale-x-100" />}
          variant="tinted"
          disabled={min !== undefined && compareCalendarDates(addDays(monthStart, -1), min) < 0}
          onPress={() => {
            setFocus(addMonths(monthStart, -1));
          }}
        />
        <p className="type-headline text-text" aria-live="polite">
          {format.calendarMonth(year, month)}
        </p>
        <IconButton
          label={t('ui.nextMonth')}
          icon={<CaretRightIcon size={20} className="rtl:-scale-x-100" />}
          variant="tinted"
          disabled={max !== undefined && compareCalendarDates(addMonths(monthStart, 1), max) > 0}
          onPress={() => {
            setFocus(addMonths(monthStart, 1));
          }}
        />
      </div>
      <div className="grid grid-cols-7 pb-1" aria-hidden>
        {[0, 1, 2, 3, 4, 5, 6].map((weekday) => (
          <span key={weekday} className="py-1 text-center type-caption text-text-tertiary">
            {format.weekdayShort(weekday)}
          </span>
        ))}
      </div>
      <div ref={grid} className="grid grid-cols-7 gap-y-1" onKeyDown={onKeyDown} role="presentation">
        {cells.map((date, index) => {
          if (!date) return <span key={`blank-${String(index)}`} aria-hidden />;
          const selected = date === value;
          const isToday = date === todayDate;
          const enabled = inRange(date, min, max);
          return (
            <div key={date} className="flex justify-center">
              <Pressable
                data-date={date}
                tabIndex={date === focus ? 0 : -1}
                disabled={!enabled}
                aria-label={format.calendarDate(date)}
                aria-pressed={selected}
                aria-current={isToday ? 'date' : undefined}
                onPress={() => {
                  onChange(date);
                  onClose();
                }}
                className={`inline-flex size-11 items-center justify-center rounded-full type-callout tabular-nums transition-state disabled:opacity-30 ${
                  selected
                    ? 'bg-primary-700 font-semibold text-on-primary'
                    : isToday
                      ? 'border-[1.5px] border-primary-700 font-semibold text-primary-700'
                      : 'text-text data-[pressed]:bg-surface-muted'
                }`}
              >
                <span aria-hidden>{String(parseCalendarDate(date).day)}</span>
              </Pressable>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
