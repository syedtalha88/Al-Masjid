import { type CSSProperties, type KeyboardEvent, useRef } from 'react';

import { Pressable } from '../motion/Pressable.tsx';

export interface Segment<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
}

export interface SegmentedControlProps<Id extends string> {
  readonly segments: readonly Segment<Id>[];
  readonly value: Id;
  readonly onChange: (id: Id) => void;
  /** Accessible name of the group ("Show"). */
  readonly label: string;
  readonly className?: string;
}

/**
 * Arrow keys move the selection (mirrored in RTL), Home/End jump; a radio group's selection follows focus.
 *
 * @returns the index to select, or null for other keys.
 */
export function arrowTarget(key: string, index: number, count: number, rtl: boolean): number | null {
  switch (key) {
    case 'ArrowRight':
      return Math.min(Math.max(index + (rtl ? -1 : 1), 0), count - 1);
    case 'ArrowLeft':
      return Math.min(Math.max(index + (rtl ? 1 : -1), 0), count - 1);
    case 'ArrowDown':
      return Math.min(index + 1, count - 1);
    case 'ArrowUp':
      return Math.max(index - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Two-to-four option switch (06 §6, ref-3 "Hadith | Quran"): surface-muted pill, the active segment filled
 * primary-700 with white text; the thumb slides (`spring.smooth`, transform only), text colors crossfade.
 * A radio group: one tab stop, arrow keys move the selection.
 */
export function SegmentedControl<Id extends string>({
  segments,
  value,
  onChange,
  label,
  className,
}: SegmentedControlProps<Id>) {
  const group = useRef<HTMLDivElement>(null);
  const activeIndex = Math.max(
    segments.findIndex((segment) => segment.id === value),
    0,
  );
  // One segment wide (container minus its 4 px padding on each side), moved by `--mc-index` segment widths.
  const thumb: CSSProperties & { '--mc-index': number } = {
    '--mc-index': activeIndex,
    width: `calc((100% - 0.5rem) / ${String(segments.length)})`,
  };

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const next = arrowTarget(event.key, index, segments.length, rtl);
    const target = next === null ? undefined : segments[next];
    if (!target || next === null) return;
    event.preventDefault();
    onChange(target.id);
    group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      className={`relative flex rounded-full bg-surface-muted p-1 ${className ?? ''}`}
    >
      <span
        aria-hidden
        className="absolute inset-y-1 start-1 rounded-full bg-primary-700 transition-thumb [transform:translateX(calc(var(--mc-index)*100%))] rtl:[transform:translateX(calc(var(--mc-index)*-100%))]"
        style={thumb}
      />
      {segments.map((segment, index) => {
        const selected = index === activeIndex;
        return (
          <Pressable
            key={segment.id}
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onPress={() => {
              onChange(segment.id);
            }}
            onKeyDown={(event) => {
              onKeyDown(event, index);
            }}
            className={`relative z-10 min-h-11 flex-1 rounded-full px-3 type-subhead-strong transition-state ${
              selected ? 'text-on-primary' : 'text-text-secondary'
            }`}
          >
            {segment.label}
          </Pressable>
        );
      })}
    </div>
  );
}
