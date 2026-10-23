// Drag-to-reorder list (07 A3 reorder mode). Each row gets a handle: drag it (pointer — touch or mouse) and the row
// follows the finger while the rows it passes slide out of the way (transforms only); release commits the move. The
// handle is also a button: Arrow Up / Arrow Down move the row by one (keyboard, switch access); screens add a
// single-tap alternative (WCAG 2.5.7) such as Move up / Move down in a row menu.
import { useTranslation } from '@mc/i18n/react';
import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useRef } from 'react';

import { DragHandleIcon } from '../icons/glyphs.tsx';
import { haptic } from '../motion/haptics.ts';

export interface ReorderListProps<T> {
  readonly items: readonly T[];
  readonly keyOf: (item: T) => string;
  /** Accessible name of each row's handle, e.g. "Reorder Test Masjid Alpha". */
  readonly handleLabel: (item: T) => string;
  /** The row's content (the handle is added at its end). */
  readonly renderItem: (item: T, index: number) => ReactNode;
  readonly onReorder: (from: number, to: number) => void;
  /** Accessible name of the list. */
  readonly label: string;
  readonly className?: string;
}

interface Drag {
  readonly pointerId: number;
  readonly from: number;
  readonly startY: number;
  /** Row tops and heights at the start (layout read once). */
  readonly tops: readonly number[];
  readonly heights: readonly number[];
  to: number;
}

export function ReorderList<T>({
  items,
  keyOf,
  handleLabel,
  renderItem,
  onReorder,
  label,
  className,
}: ReorderListProps<T>) {
  const { t } = useTranslation();
  const list = useRef<HTMLUListElement>(null);
  /** The rows, read from the DOM when needed (never kept across renders). */
  const rowsOf = (): HTMLLIElement[] => [...(list.current?.querySelectorAll<HTMLLIElement>(':scope > li') ?? [])];
  const drag = useRef<Drag | null>(null);
  const focusKey = useRef<string | null>(null);

  // After a keyboard move the handle follows its row.
  useEffect(() => {
    const key = focusKey.current;
    if (key === null) return;
    focusKey.current = null;
    list.current
      ?.querySelector<HTMLLIElement>(`:scope > li[data-key="${CSS.escape(key)}"]`)
      ?.querySelector<HTMLButtonElement>('[data-reorder-handle]')
      ?.focus();
  });

  const paint = (current: Drag, dy: number) => {
    const moved = current.heights[current.from] ?? 0;
    rowsOf().forEach((row, index) => {
      if (index === current.from) {
        row.style.transform = `translateY(${String(dy)}px)`;
        return;
      }
      const shift =
        current.from < current.to && index > current.from && index <= current.to
          ? -moved
          : current.from > current.to && index < current.from && index >= current.to
            ? moved
            : 0;
      row.style.transform = shift === 0 ? '' : `translateY(${String(shift)}px)`;
    });
  };

  const clear = () => {
    for (const row of rowsOf()) {
      row.style.transition = 'none';
      row.style.transform = '';
      delete row.dataset['dragging'];
      // Re-enable the slide transition after this frame's layout.
      requestAnimationFrame(() => {
        row.style.transition = '';
      });
    }
  };

  const onPointerDown = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || drag.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rows = rowsOf();
    const measured = rows.map((row) => row.getBoundingClientRect());
    drag.current = {
      pointerId: event.pointerId,
      from: index,
      to: index,
      startY: event.clientY,
      tops: measured.map((rect) => rect.top),
      heights: measured.map((rect) => rect.height),
    };
    const row = rows[index];
    if (row) row.dataset['dragging'] = 'true';
    haptic('impactLight');
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const dy = event.clientY - current.startY;
    const center = (current.tops[current.from] ?? 0) + (current.heights[current.from] ?? 0) / 2 + dy;
    // The new index = how many other rows would sit above the dragged one.
    let to = 0;
    current.tops.forEach((top, index) => {
      if (index !== current.from && center > top + (current.heights[index] ?? 0) / 2) to += 1;
    });
    if (to !== current.to) {
      current.to = to;
      haptic('selection');
    }
    paint(current, dy);
  };

  const onPointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    drag.current = null;
    clear();
    if (current.to !== current.from) onReorder(current.from, current.to);
  };

  const onKeyDown = (index: number, key: string) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : null;
    if (to === null || to < 0 || to >= items.length) return;
    event.preventDefault();
    focusKey.current = key;
    onReorder(index, to);
  };

  return (
    <ul ref={list} aria-label={label} className={`flex flex-col gap-3 ${className ?? ''}`}>
      {items.map((item, index) => {
        const key = keyOf(item);
        return (
          <li
            key={key}
            data-key={key}
            className="relative flex items-center gap-2 transition-thumb data-[dragging]:z-10 data-[dragging]:shadow-e2 data-[dragging]:transition-none"
          >
            <div className="min-w-0 flex-1">{renderItem(item, index)}</div>
            <button
              type="button"
              data-reorder-handle
              aria-label={handleLabel(item)}
              title={t('ui.reorderHint')}
              onPointerDown={onPointerDown(index)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onKeyDown={onKeyDown(index, key)}
              className="inline-flex size-(--mc-hit) shrink-0 cursor-grab touch-none items-center justify-center rounded-full text-text-secondary active:cursor-grabbing"
            >
              <DragHandleIcon />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
