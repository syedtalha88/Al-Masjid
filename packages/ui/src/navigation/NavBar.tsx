import type { ReactNode, Ref } from 'react';

export type NavBarVariant = 'large' | 'inline';

export interface NavBarProps {
  readonly title: string;
  /** Inline variant: a caption under the title (masjid name — ref-2). */
  readonly subtitle?: string;
  readonly variant: NavBarVariant;
  /** Back / close control at the leading edge. */
  readonly leading?: ReactNode;
  /** Trailing actions. */
  readonly actions?: ReactNode;
  /** Large variant: the bar and its inline title, driven by `useLargeTitleCollapse` in the screen. */
  readonly barRef?: Ref<HTMLElement>;
  readonly inlineTitleRef?: Ref<HTMLDivElement>;
}

/** Linear 0–1 progress of `value` between `from` and `to`. */
const progress = (value: number, from: number, to: number) => Math.min(Math.max((value - from) / (to - from), 0), 1);

/**
 * Collapse of a `large` nav bar (08 §4), written to the DOM from a passive scroll listener (no React renders):
 * the large title scales to 0.85 and fades over 0–44 px; the inline title fades in over 30–56 px, and the
 * bar gains its surface, hairline and `e2` shadow (`--mc-bar-progress`).
 *
 * @returns a scroll handler for the screen's scroll container.
 */
export function largeTitleCollapse(
  scroller: HTMLElement,
  parts: {
    readonly largeTitle: HTMLElement | null;
    readonly bar: HTMLElement | null;
    readonly inlineTitle: HTMLElement | null;
  },
): () => void {
  const y = scroller.scrollTop;
  const collapse = progress(y, 0, 44);
  const shown = progress(y, 30, 56);
  return () => {
    if (parts.largeTitle) {
      parts.largeTitle.style.transform = `scale(${String(1 - collapse * 0.15)})`;
      parts.largeTitle.style.opacity = String(1 - collapse);
    }
    if (parts.inlineTitle) parts.inlineTitle.style.opacity = String(shown);
    parts.bar?.style.setProperty('--mc-bar-progress', String(shown));
  };
}

/**
 * Navigation bar (06 §6, 08 §4). `inline`: back chevron + centered `headline` title (+ caption subtitle) — the
 * screen's `<h1>`. `large`: the large title (the `<h1>`) lives at the top of the scrolling content and this
 * bar shows a centered inline copy only once it scrolls away (see {@link largeTitleCollapse}).
 */
export function NavBar({ title, subtitle, variant, leading, actions, barRef, inlineTitleRef }: NavBarProps) {
  const large = variant === 'large';
  return (
    <header
      ref={barRef}
      className={`relative z-10 grid min-h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 pt-safe px-screen ${
        large ? 'nav-bar-collapsing' : 'bg-bg'
      }`}
    >
      <div className="flex min-w-0 items-center justify-start">{leading}</div>
      <div
        ref={inlineTitleRef}
        aria-hidden={large || undefined}
        className={`flex min-w-0 max-w-[60vw] flex-col items-center text-center ${large ? 'opacity-0' : ''}`}
      >
        {large ? (
          <span className="truncate type-headline text-text">{title}</span>
        ) : (
          <h1 data-screen-title tabIndex={-1} className="max-w-full truncate type-headline text-text outline-none">
            {title}
          </h1>
        )}
        {subtitle && !large ? (
          <span className="max-w-full truncate type-caption text-text-tertiary">{subtitle}</span>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-1">{actions}</div>
    </header>
  );
}
