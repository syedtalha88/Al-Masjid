import { from12Hour, parseWallClock, to12Hour, toWallClock } from '@mc/domain/time';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef } from 'react';

import { haptic } from '../motion/haptics.ts';
import { useMotionPrefs } from '../motion/MotionProvider.tsx';

/** Rows visible in a wheel; the middle one is selected. */
const VISIBLE_ROWS = 5;
/** Quiet time after the last scroll event that counts as "settled" where `scrollend` is missing, ms. */
const SETTLE_MS = 120;

interface WheelItem {
  readonly key: string;
  readonly label: string;
}

interface WheelColumnProps {
  readonly items: readonly WheelItem[];
  readonly index: number;
  readonly onIndexChange: (index: number) => void;
  /** Accessible name of the column ("Hour"). */
  readonly label: string;
  readonly className?: string;
}

/**
 * One wheel column (08 §5.12): native momentum + scroll-snap; the row nearest the middle is selected and
 * scales 1.0 while the others shrink to 0.92 and fade — written to the DOM from scroll position, no React
 * renders per frame. A focusable `spinbutton`: ArrowUp/Down, PageUp/Down (±5), Home/End.
 */
function WheelColumn({ items, index, onIndexChange, label, className }: WheelColumnProps) {
  const { reduced } = useMotionPrefs();
  const scroller = useRef<HTMLDivElement>(null);
  const settled = useRef(index);
  const frame = useRef(0);

  const rowHeight = () => scroller.current?.querySelector<HTMLElement>('[data-row]')?.offsetHeight ?? 1;

  const paint = () => {
    frame.current = 0;
    const node = scroller.current;
    if (!node) return;
    const height = rowHeight();
    const center = node.scrollTop / height;
    node.querySelectorAll<HTMLElement>('[data-row]').forEach((row, rowIndex) => {
      const distance = Math.min(Math.abs(rowIndex - center), 2.5);
      row.style.transform = `scale(${String(1 - Math.min(distance, 1) * 0.08)})`;
      row.style.opacity = String(Math.max(1 - distance * 0.35, 0.25));
    });
  };

  // Bring the selected row to the middle when the value changes from outside (or on mount).
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const target = index * rowHeight();
    if (Math.round(node.scrollTop / rowHeight()) === index) {
      paint();
      return;
    }
    const first = settled.current === index;
    settled.current = index;
    node.scrollTo({ top: target, behavior: first || reduced ? 'auto' : 'smooth' });
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paint/rowHeight read refs only
  }, [index, reduced]);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      const next = Math.min(Math.max(Math.round(node.scrollTop / rowHeight()), 0), items.length - 1);
      if (next !== settled.current) {
        settled.current = next;
        haptic('selection');
        onIndexChange(next);
      }
    };
    const onScroll = () => {
      if (!frame.current) frame.current = requestAnimationFrame(paint);
      if (!('onscrollend' in window)) {
        clearTimeout(timer);
        timer = setTimeout(settle, SETTLE_MS);
      }
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    node.addEventListener('scrollend', settle);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame.current);
      node.removeEventListener('scroll', onScroll);
      node.removeEventListener('scrollend', settle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paint/rowHeight read refs only
  }, [items.length, onIndexChange]);

  const onKeyDown = (event: KeyboardEvent) => {
    const last = items.length - 1;
    const keys: Record<string, number> = {
      ArrowUp: index - 1,
      ArrowDown: index + 1,
      PageUp: index - 5,
      PageDown: index + 5,
      Home: 0,
      End: last,
    };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onIndexChange(Math.min(Math.max(next, 0), last));
  };

  return (
    <div className={`relative ${className ?? ''}`}>
      <div
        ref={scroller}
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={items.length - 1}
        aria-valuenow={index}
        aria-valuetext={items[index]?.label}
        onKeyDown={onKeyDown}
        className="scroller relative z-10 snap-y snap-mandatory rounded-sm [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-scrollbar]:hidden"
        style={{
          height: `calc(var(--mc-wheel-row) * ${String(VISIBLE_ROWS)})`,
          paddingBlock: `calc(var(--mc-wheel-row) * ${String((VISIBLE_ROWS - 1) / 2)})`,
        }}
      >
        {items.map((item, itemIndex) => (
          <div
            key={item.key}
            data-row
            aria-hidden
            onClick={() => {
              onIndexChange(itemIndex);
            }}
            className="flex h-(--mc-wheel-row) snap-center items-center justify-center type-title2 text-text tabular-nums"
          >
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface TimeWheelProps {
  /** 24-hour wall-clock time "HH:mm". */
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Minute granularity (default 1; 5 for jamaat times). */
  readonly minuteStep?: 1 | 5;
  /** Accessible name of the whole picker ("Jamaat time"). */
  readonly label: string;
  readonly className?: string;
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * iOS-style time picker (06 §6, 08 §5.12): hour · minute · AM/PM wheels over a mint selection band. Value in
 * and out is a 24-hour "HH:mm" (domain/time); display is 12-hour with Latin digits, never mirrored (`dir=ltr`).
 */
export function TimeWheel({ value, onChange, minuteStep = 1, label, className }: TimeWheelProps) {
  const { t } = useTranslation();
  const { format } = useLocale();
  const { hour, minute } = parseWallClock(value);
  const { hour12, pm } = to12Hour(hour);

  const hours: WheelItem[] = Array.from({ length: 12 }, (_, index) => ({
    key: String(index + 1),
    label: String(index + 1),
  }));
  const minutes: WheelItem[] = Array.from({ length: 60 / minuteStep }, (_, index) => ({
    key: String(index * minuteStep),
    label: pad(index * minuteStep),
  }));
  const periods: WheelItem[] = [
    { key: 'am', label: format.time('09:00').period },
    { key: 'pm', label: format.time('21:00').period },
  ];
  const minuteIndex = Math.min(Math.round(minute / minuteStep), minutes.length - 1);

  const emit = (nextHour12: number, nextMinute: number, nextPm: boolean) => {
    onChange(toWallClock(from12Hour(nextHour12, nextPm), nextMinute));
  };

  return (
    <div role="group" aria-label={label} dir="ltr" className={`relative flex justify-center gap-2 ${className ?? ''}`}>
      {/* The selection band behind the middle row. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 h-(--mc-wheel-row) -translate-y-1/2 rounded-sm bg-mint-50"
      />
      <WheelColumn
        items={hours}
        index={hour12 - 1}
        label={t('ui.hour')}
        onIndexChange={(index) => {
          emit(index + 1, minuteIndex * minuteStep, pm);
        }}
        className="w-20"
      />
      <WheelColumn
        items={minutes}
        index={minuteIndex}
        label={t('ui.minute')}
        onIndexChange={(index) => {
          emit(hour12, index * minuteStep, pm);
        }}
        className="w-20"
      />
      <WheelColumn
        items={periods}
        index={pm ? 1 : 0}
        label={t('ui.period')}
        onIndexChange={(index) => {
          emit(hour12, minuteIndex * minuteStep, index === 1);
        }}
        className="w-20"
      />
    </div>
  );
}
