import { animate, motionValue } from 'motion/react';
import { type PointerEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useMotionPrefs } from '../motion/MotionProvider.tsx';
import { gesture, spring, springPhysics, tween } from '../motion/tokens.ts';

export interface PagerProps {
  readonly pageCount: number;
  readonly index: number;
  readonly onIndexChange: (index: number) => void;
  /** May the user swipe forward from this page (e.g. a choice is made)? Backward is always allowed. */
  readonly canAdvance?: (index: number) => boolean;
  /** Renders one page; `parallax` marks elements that move at half speed (illustrations — 08 §5.11). */
  readonly children: (index: number) => ReactNode;
  readonly className?: string;
}

/** Finger travel (fraction of the width) that commits a page change on release. */
const COMMIT_FRACTION = 0.25;

/**
 * Full-width horizontal pages (07 A1 onboarding, 08 §5.11): the track follows the finger 1:1 (resisting where there is
 * no allowed neighbour), commits on 25 % or a flick and springs with the release velocity; elements marked
 * `data-parallax` travel at half speed. RTL mirrors the direction. Reduced motion: pages switch with a crossfade.
 * Only the current page is interactive; the others are `inert` and hidden from assistive tech.
 */
export function Pager({ pageCount, index, onIndexChange, canAdvance, children, className }: PagerProps) {
  const { reduced } = useMotionPrefs();
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [x] = useState(() => motionValue(0));
  const drag = useRef<{
    id: number;
    startX: number;
    startY: number;
    base: number;
    samples: [number, number][];
    active: boolean;
  } | null>(null);
  const [rtl, setRtl] = useState(false);

  const width = () => viewport.current?.offsetWidth ?? 0;
  // Page offset in px for an index (pages run right-to-left in RTL).
  const offsetOf = useCallback((page: number) => -page * (viewport.current?.offsetWidth ?? 0) * (rtl ? -1 : 1), [rtl]);

  // Paint every frame of `x` straight to the DOM (no React renders during a swipe — 08 §9).
  useEffect(() => {
    const paint = (value: number) => {
      const node = track.current;
      if (!node) return;
      node.style.transform = `translate3d(${String(value)}px, 0, 0)`;
      const w = width();
      for (const element of node.querySelectorAll<HTMLElement>('[data-parallax]')) {
        const page = Number(element.closest<HTMLElement>('[data-page]')?.dataset['page'] ?? 0);
        const relative = w > 0 ? value - offsetOf(page) : 0;
        element.style.transform = `translate3d(${String(-relative * 0.5)}px, 0, 0)`;
      }
    };
    paint(x.get());
    return x.on('change', paint);
  }, [x, offsetOf]);

  // The direction follows <html dir> (the language page flips it live — 07 A1).
  useLayoutEffect(() => {
    const read = () => {
      if (viewport.current) setRtl(getComputedStyle(viewport.current).direction === 'rtl');
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['dir'] });
    return () => {
      observer.disconnect();
    };
  }, []);

  // Move to the current index (after a swipe, a button press or a language change that flips RTL).
  useEffect(() => {
    const target = offsetOf(index);
    if (reduced || width() === 0) {
      x.set(target);
      const node = track.current;
      if (node && reduced) {
        node.style.opacity = '0';
        void animate(0, 1, {
          ...tween.fade,
          onUpdate: (value) => {
            node.style.opacity = String(value);
          },
        });
      }
      return;
    }
    const controls = animate(x, target, springPhysics(spring.smooth));
    return () => {
      controls.stop();
    };
    // `offsetOf` changes with the direction, so the track lands on the mirrored position after a flip.
  }, [index, reduced, offsetOf, x]);

  useEffect(() => {
    const onResize = () => {
      x.set(offsetOf(index));
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  });

  const allowed = (from: number, step: number) => {
    const to = from + step;
    if (to < 0 || to >= pageCount) return false;
    return step < 0 || (canAdvance?.(from) ?? true);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || reduced) return;
    if (event.target instanceof Element && event.target.closest('input, textarea, [data-no-swipe]')) return;
    drag.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      base: x.get(),
      samples: [[event.timeStamp, event.clientX]],
      active: false,
    };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current?.id !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        drag.current = null;
        return;
      }
      if (Math.abs(dx) < 10) return;
      current.active = true;
      x.stop();
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    current.samples = [...current.samples.slice(-4), [event.timeStamp, event.clientX]];
    const step = (dx < 0 ? 1 : -1) * (rtl ? -1 : 1);
    x.set(current.base + dx * (allowed(index, step) ? 1 : 0.2));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    drag.current = null;
    if (current?.id !== event.pointerId || !current.active) return;
    const dx = event.clientX - current.startX;
    const [first] = current.samples;
    const seconds = first ? Math.max((event.timeStamp - first[0]) / 1000, 0.016) : 1;
    const velocity = first ? (event.clientX - first[1]) / seconds : 0;
    const step = (dx < 0 ? 1 : -1) * (rtl ? -1 : 1);
    const commit = Math.abs(dx) > width() * COMMIT_FRACTION || Math.abs(velocity) > gesture.dismissVelocity;
    if (commit && allowed(index, step)) onIndexChange(index + step);
    else void animate(x, offsetOf(index), { ...springPhysics(spring.smooth), velocity });
  };

  return (
    <div
      ref={viewport}
      className={`relative overflow-hidden touch-pan-y ${className ?? ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null;
        void animate(x, offsetOf(index), springPhysics(spring.smooth));
      }}
    >
      <div ref={track} className="flex h-full will-change-transform">
        {Array.from({ length: pageCount }, (_, page) => (
          <div
            key={page}
            data-page={page}
            className="h-full w-full shrink-0"
            inert={page !== index}
            aria-hidden={page !== index}
          >
            {children(page)}
          </div>
        ))}
      </div>
    </div>
  );
}
