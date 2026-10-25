import type { ReactNode } from 'react';

import { CaretRightIcon } from '../icons/glyphs.tsx';
import { Pressable } from '../motion/Pressable.tsx';

export interface ListRowProps {
  /** Leading icon circle / thumbnail (decorative). */
  readonly leading?: ReactNode;
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  /** Meta line (`caption`, tertiary): "Masjid Al-Noor • 2 hours ago". */
  readonly meta?: ReactNode;
  /** Trailing badge / value, before the chevron. */
  readonly trailing?: ReactNode;
  /** Show the disclosure chevron (default: when pressable). Mirrors in RTL. */
  readonly chevron?: boolean;
  /** Makes the whole row one tap target (press scale 0.98). */
  readonly onPress?: () => void;
  /** Clamp the subtitle to this many lines (default 2). */
  readonly subtitleLines?: 1 | 2 | 3;
  /**
   * `auto` when the title is text the user did not choose the language of (an admin-written notice): an English title
   * in the Urdu UI then reads left-to-right and its "…" lands at its end, not its start (T2.11, T2.14).
   */
  readonly textDir?: 'auto';
  readonly className?: string;
}

const CLAMP = { 1: 'line-clamp-1', 2: 'line-clamp-2', 3: 'line-clamp-3' } as const;

/**
 * List row (06 §6): leading icon/thumb · title / subtitle / meta · trailing badge · chevron; ≥ 56 px tall.
 * Pressable rows are a single button; the screen reader reads title, subtitle, meta and badge in order.
 */
export function ListRow({
  leading,
  title,
  subtitle,
  meta,
  trailing,
  chevron,
  onPress,
  subtitleLines = 2,
  textDir,
  className,
}: ListRowProps) {
  const showChevron = chevron ?? onPress !== undefined;
  const body = (
    <>
      {leading ? <span className="inline-flex shrink-0">{leading}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span dir={textDir} className="type-subhead-strong text-text">
          {title}
        </span>
        {subtitle ? (
          <span className={`type-footnote text-text-secondary ${CLAMP[subtitleLines]}`}>{subtitle}</span>
        ) : null}
        {meta ? <span className="type-caption text-text-tertiary">{meta}</span> : null}
      </span>
      {trailing ? <span className="inline-flex shrink-0 items-center">{trailing}</span> : null}
      {showChevron ? <CaretRightIcon size={18} className="shrink-0 text-text-tertiary rtl:-scale-x-100" /> : null}
    </>
  );
  const layout = `flex min-h-14 w-full items-center gap-3 py-3 text-start ${className ?? ''}`;
  if (!onPress) return <div className={layout}>{body}</div>;
  return (
    <Pressable kind="card" onPress={onPress} className={`${layout} rounded-sm data-[pressed]:bg-surface-muted`}>
      {body}
    </Pressable>
  );
}
