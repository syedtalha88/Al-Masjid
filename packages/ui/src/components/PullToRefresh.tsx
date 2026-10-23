// Pull-to-refresh (08 §4) for a screen scroller (`[data-screen-scroll]`, which already blocks the browser's own pull
// with overscroll containment). At the top, a downward touch drag moves the content by `distance ^ 0.7`; a mint circle
// with a spinner reveals and turns with the pull. Released past 72px → haptic + refresh: the content waits at 56px
// with the spinner running until `onRefresh` settles, then springs back. Transforms only, one write per frame.
import { useTranslation } from '@mc/i18n/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { RefreshIcon } from '../icons/glyphs.tsx';
import { haptic } from '../motion/haptics.ts';
import { gesture } from '../motion/tokens.ts';

export interface PullToRefreshProps {
  /** Resolves (or rejects) when the refreshed data has settled. */
  readonly onRefresh: () => Promise<unknown>;
  readonly children: ReactNode;
}

/** The content offset for a finger travel (rubber band). */
export const pullOffset = (distance: number): number => (distance <= 0 ? 0 : distance ** gesture.pullExponent);

export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLDivElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useRef(onRefresh);
  useEffect(() => {
    refresh.current = onRefresh;
  });

  useEffect(() => {
    const scroller = root.current?.closest<HTMLElement>('[data-screen-scroll]');
    const body = content.current;
    const circle = indicator.current;
    if (!scroller || !body || !circle) return;
    let startY: number | null = null;
    let offset = 0;
    let busy = false;
    let frame = 0;

    const paint = (animate: boolean) => {
      frame = 0;
      const transition = animate ? 'transform var(--mc-spring-smooth), opacity var(--mc-spring-smooth)' : 'none';
      body.style.transition = transition;
      circle.style.transition = transition;
      body.style.transform = offset > 0 ? `translateY(${String(offset)}px)` : '';
      const progress = Math.min(offset / gesture.pullRefreshPx, 1);
      circle.style.opacity = String(progress);
      circle.style.transform = `translateY(${String(offset - gesture.pullHoldPx)}px) rotate(${String(progress * 270)}deg)`;
    };
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          paint(false);
        });
    };

    const onStart = (event: TouchEvent) => {
      if (busy || scroller.scrollTop > 0 || event.touches.length !== 1) return;
      startY = event.touches[0]?.clientY ?? null;
    };
    const onMove = (event: TouchEvent) => {
      if (startY === null || busy) return;
      const distance = (event.touches[0]?.clientY ?? startY) - startY;
      if (distance <= 0 || scroller.scrollTop > 0) {
        if (offset !== 0) {
          offset = 0;
          schedule();
        }
        return;
      }
      if (event.cancelable) event.preventDefault(); // our pull, not a scroll
      offset = pullOffset(distance);
      schedule();
    };
    const onEnd = () => {
      if (startY === null) return;
      startY = null;
      cancelAnimationFrame(frame);
      if (offset < gesture.pullRefreshPx) {
        offset = 0;
        paint(true);
        return;
      }
      haptic('impactLight');
      busy = true;
      offset = gesture.pullHoldPx;
      paint(true);
      setRefreshing(true);
      void refresh
        .current()
        .catch(() => undefined) // the screen shows its own error state
        .finally(() => {
          busy = false;
          offset = 0;
          paint(true);
          setRefreshing(false);
        });
    };

    scroller.addEventListener('touchstart', onStart, { passive: true });
    scroller.addEventListener('touchmove', onMove, { passive: false });
    scroller.addEventListener('touchend', onEnd);
    scroller.addEventListener('touchcancel', onEnd);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('touchstart', onStart);
      scroller.removeEventListener('touchmove', onMove);
      scroller.removeEventListener('touchend', onEnd);
      scroller.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  return (
    <div ref={root} className="relative">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center">
        <div
          ref={indicator}
          data-pull-indicator
          className="flex size-10 items-center justify-center rounded-full bg-mint-100 text-primary-700 opacity-0 shadow-e1"
        >
          <RefreshIcon size={20} className={refreshing ? 'spin' : ''} />
        </div>
      </div>
      <p role="status" className="sr-only">
        {refreshing ? t('ui.refreshing') : ''}
      </p>
      <div ref={content}>{children}</div>
    </div>
  );
}
