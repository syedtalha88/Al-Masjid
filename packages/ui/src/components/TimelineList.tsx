// TimelineList (06 §6 Content, ref-2/4 Updates): 44px icon circles joined by a 2px border-coloured line; masjid name,
// title, a two-line snippet, time; chevron; a small primary dot on unseen rows. Rows past the first screens skip
// rendering until near the viewport (`content-visibility: auto` — the list stays light with hundreds of rows).
import type { ReactNode } from 'react';

import { CaretRightIcon } from '../icons/glyphs.tsx';
import { Pressable } from '../motion/Pressable.tsx';

export interface TimelineRow {
  readonly key: string;
  /** The category icon circle (44px). */
  readonly icon: ReactNode;
  readonly masjid?: string | undefined;
  readonly title: string;
  readonly snippet?: string | undefined;
  readonly time: string;
  readonly unseen?: boolean;
  /** Screen-reader text for the unseen dot ("New"). */
  readonly unseenLabel?: string;
  readonly onPress: () => void;
}

export function TimelineList({
  rows,
  className,
}: {
  readonly rows: readonly TimelineRow[];
  readonly className?: string;
}) {
  return (
    <ul className={`relative flex flex-col ${className ?? ''}`}>
      {rows.map((row, index) => (
        <li
          key={row.key}
          data-key={row.key}
          className="relative [contain-intrinsic-size:auto_6rem] [content-visibility:auto]"
        >
          {/* Connector: from this circle down to the next one. */}
          {index < rows.length - 1 ? (
            <span aria-hidden className="absolute start-[1.3125rem] top-14 -bottom-2 w-0.5 bg-border" />
          ) : null}
          <Pressable kind="card" onPress={row.onPress} className="flex w-full items-start gap-3 py-2 text-start">
            <span className="relative z-10 shrink-0">{row.icon}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              {row.masjid ? <span className="truncate type-subhead-strong text-text">{row.masjid}</span> : null}
              <span className="line-clamp-2 type-subhead-strong text-text">{row.title}</span>
              {row.snippet ? (
                <span className="line-clamp-2 type-footnote text-text-secondary">{row.snippet}</span>
              ) : null}
              <span className="type-caption text-text-tertiary">{row.time}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2 self-center">
              {row.unseen ? (
                <span data-unseen-dot className="size-2 rounded-full bg-primary-600">
                  <span className="sr-only">{row.unseenLabel}</span>
                </span>
              ) : null}
              <CaretRightIcon size={20} className="text-text-secondary rtl:-scale-x-100" />
            </span>
          </Pressable>
        </li>
      ))}
    </ul>
  );
}
