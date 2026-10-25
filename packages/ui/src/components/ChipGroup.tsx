import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

import { useMotionPrefs } from '../motion/MotionProvider.tsx';
import { Pressable } from '../motion/Pressable.tsx';
import { arrowTarget } from './SegmentedControl.tsx';

export interface Chip<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
}

export interface ChipGroupProps<Id extends string> {
  readonly chips: readonly Chip<Id>[];
  readonly value: Id;
  readonly onChange: (id: Id) => void;
  /** Accessible name ("Filter"). */
  readonly label: string;
  readonly className?: string;
}

/** Which edges have more chips beyond them (fade masks), in inline terms. */
type Overflow = 'none' | 'start' | 'end' | 'both';

function overflowOf(scroller: HTMLElement): Overflow {
  const max = scroller.scrollWidth - scroller.clientWidth;
  if (max <= 1) return 'none';
  // RTL scrollLeft runs 0 → −max in every current engine.
  const fromStart = Math.abs(scroller.scrollLeft);
  const atStart = fromStart <= 1;
  const atEnd = fromStart >= max - 1;
  if (atStart) return 'end';
  if (atEnd) return 'start';
  return 'both';
}

const MASK: Readonly<Record<Overflow, string>> = {
  none: '',
  start: 'mask-fade-start',
  end: 'mask-fade-end',
  both: 'mask-fade-both',
};

/**
 * Filter chips (06 §6, ref-3): a horizontally scrollable row, 36 px pills in 44 px hit rows, active filled
 * primary-700 / white, inactive surface-muted; fade masks show at the edges with more chips; the active chip
 * scrolls into view. A radio group (one tab stop, arrow keys, mirrored in RTL).
 */
export function ChipGroup<Id extends string>({ chips, value, onChange, label, className }: ChipGroupProps<Id>) {
  const { reduced } = useMotionPrefs();
  const scroller = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<Overflow>('none');
  const activeIndex = Math.max(
    chips.findIndex((chip) => chip.id === value),
    0,
  );

  // Measured when layout has happened anyway — the ResizeObserver's first callback (after layout, before paint) and
  // scrolls — never synchronously in a commit: a parent's re-render during navigation would otherwise force a full
  // page layout inside the tap (≈ 125 ms at 4× CPU, perf trace T2.14). Keyed by content, not array identity.
  const chipsKey = chips.map((chip) => `${chip.id}\u0000${chip.label}`).join('\u0001');
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const update = () => {
      setOverflow(overflowOf(node));
    };
    node.addEventListener('scroll', update, { passive: true });
    if (typeof ResizeObserver === 'undefined') {
      update();
      return () => {
        node.removeEventListener('scroll', update);
      };
    }
    // A new observer per change of chips: its first callback measures after the next layout.
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      node.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [chipsKey]);

  // Keep the active chip fully visible (scrolls the row only, never the page).
  useEffect(() => {
    const node = scroller.current;
    const chip = node?.querySelectorAll<HTMLElement>('[role="radio"]')[activeIndex];
    if (!node || !chip) return;
    const box = node.getBoundingClientRect();
    const rect = chip.getBoundingClientRect();
    const padding = 20;
    let delta = 0;
    if (rect.left < box.left + padding) delta = rect.left - box.left - padding;
    else if (rect.right > box.right - padding) delta = rect.right - box.right + padding;
    if (delta !== 0) node.scrollBy({ left: delta, behavior: reduced ? 'auto' : 'smooth' });
  }, [activeIndex, reduced]);

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const next = arrowTarget(event.key, index, chips.length, rtl);
    const target = next === null ? undefined : chips[next];
    if (!target || next === null) return;
    event.preventDefault();
    onChange(target.id);
    scroller.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div
      ref={scroller}
      role="radiogroup"
      aria-label={label}
      className={`scroller-x flex gap-2 px-screen ${MASK[overflow]} ${className ?? ''}`}
    >
      {chips.map((chip, index) => {
        const selected = index === activeIndex;
        return (
          <Pressable
            key={chip.id}
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onPress={() => {
              onChange(chip.id);
            }}
            onKeyDown={(event) => {
              onKeyDown(event, index);
            }}
            className="group inline-flex min-h-11 shrink-0 items-center"
          >
            <span
              className={`inline-flex h-9 items-center rounded-full px-4 type-subhead-strong whitespace-nowrap transition-state ${
                selected
                  ? 'bg-primary-700 text-on-primary'
                  : 'bg-surface-muted text-text-secondary group-data-[pressed]:bg-border'
              }`}
            >
              {chip.label}
            </span>
          </Pressable>
        );
      })}
    </div>
  );
}
