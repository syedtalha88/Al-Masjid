import { useTranslation } from '@mc/i18n/react';
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { XIcon } from '../icons/glyphs.tsx';
import { useMotionPrefs } from '../motion/MotionProvider.tsx';
import { animateChannel, getChannel, holdLayer, initLayer, setChannel } from '../navigation/driver.ts';
import { IconButton } from './Button.tsx';

export type SheetSnap = 'content' | 'full';

export interface SheetProps {
  readonly open: boolean;
  /** Asked to close (drag down, backdrop tap, Esc, close button); set `open` to false to close. */
  readonly onClose: () => void;
  /** Visible title (`headline`) and the dialog's accessible name. */
  readonly title: string;
  /** Snap points, first = initial: `content` fits the content (≤ 90%), `full` = 90% of the screen. */
  readonly snaps?: readonly SheetSnap[];
  /** Show a close (×) button in the header (default true). */
  readonly closeButton?: boolean;
  /** Sticky actions under the scrolling content (e.g. a primary button). */
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}

/** Release projection (s): where the sheet would be this long after release at its velocity. */
const PROJECTION_S = 0.2;
/** Flick speed (px/s) that always dismisses, wherever the sheet is. */
const FLING_DISMISS = 1200;

/** Rubber band past the top snap (08 §5.3): resistance grows with distance (`d^0.7`). */
const rubber = (distance: number) => distance ** 0.7;

interface DragState {
  /** Pointer/touch id, -1 for touch. */
  readonly id: number;
  readonly startY: number;
  readonly startOffset: number;
  readonly samples: [y: number, time: number][];
  readonly release: () => void;
}

/**
 * Bottom sheet (06 §6, 08 §5.3): top radius 28, grabber, `content` / `full` snaps, drag with rubber band,
 * release to the nearest snap by velocity projection (finger velocity handed to the spring) or dismiss,
 * backdrop that fades with the drag. A native modal `<dialog>`: focus trap, inert background, `Esc`. Dragging
 * down on the content when it is scrolled to the top moves the sheet (scroll hand-off). Reduced motion →
 * fades. Focus moves to the title on open and returns to the opener on close.
 */
export function Sheet({ open, onClose, title, snaps = ['content'], closeButton = true, footer, children }: SheetProps) {
  const { t } = useTranslation();
  const { reduced } = useMotionPrefs();
  const titleId = useId();
  const [mounted, setMounted] = useState(open);
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const snapOffsets = useRef<number[]>([0]);
  const drag = useRef<DragState | null>(null);
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  if (open && !mounted) setMounted(true);

  // Never 0 (an unlaid-out panel), so percentages stay finite.
  const height = () => Math.max(panel.current?.offsetHeight ?? 0, 1);
  const toPercent = (px: number) => (px / height()) * 100;
  const offset = () => (getChannel(panel.current, 'y') / 100) * height();
  /** Open-state offsets (px from fully open): 0 = top of the panel at its max position. */
  const measureSnaps = useCallback(() => {
    const node = panel.current;
    const content = scroller.current;
    if (!node || !content) return;
    const panelHeight = node.offsetHeight;
    const natural = panelHeight - content.clientHeight + content.scrollHeight;
    snapOffsets.current = snaps
      .map((snap) => (snap === 'full' ? 0 : Math.max(panelHeight - natural, 0)))
      .filter((value, index, all) => all.indexOf(value) === index);
  }, [snaps]);

  const backdropFor = (px: number) => {
    const lowest = Math.max(...snapOffsets.current);
    const range = height() - lowest;
    return range <= 0 ? 1 : Math.min(Math.max(1 - (px - lowest) / range, 0), 1);
  };

  // Open: show the modal dialog, start off-screen, spring to the first snap. Reopening while a close is
  // still animating springs back from where the sheet is.
  useLayoutEffect(() => {
    if (!mounted || !open) return;
    const node = dialog.current;
    if (!node) return;
    closing.current = false;
    if (!node.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      node.showModal();
      heading.current?.focus({ preventScroll: true });
      if (reduced) initLayer(panel.current, { opacity: 0 });
      else initLayer(panel.current, { y: 100, opacity: 1 });
      initLayer(backdrop.current, { opacity: 0 });
    }
    measureSnaps();
    const first = toPercent(snapOffsets.current[0] ?? 0);
    if (reduced) {
      setChannel(panel.current, 'y', first);
      void animateChannel(panel.current, 'opacity', 1, 'fade');
      void animateChannel(backdrop.current, 'opacity', 1, 'fade');
    } else {
      void animateChannel(panel.current, 'y', first, 'smooth');
      void animateChannel(backdrop.current, 'opacity', 1, 'smooth');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the sheet opens
  }, [mounted, open]);

  // Close: animate out (joining a drag-dismiss already under way), then close the dialog and unmount.
  useEffect(() => {
    if (open || !mounted) return;
    closing.current = true;
    const moves = reduced
      ? [animateChannel(panel.current, 'opacity', 0, 'fade'), animateChannel(backdrop.current, 'opacity', 0, 'fade')]
      : [animateChannel(panel.current, 'y', 100, 'smooth'), animateChannel(backdrop.current, 'opacity', 0, 'smooth')];
    void Promise.all(moves).then((done) => {
      if (!done.every(Boolean) || !closing.current) return;
      dialog.current?.close();
      setMounted(false);
      const target = opener.current;
      if (target?.isConnected && document.activeElement === document.body) target.focus({ preventScroll: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the sheet is asked to close
  }, [open]);

  // ---- Drag ---------------------------------------------------------------------------------------------
  const startDrag = (id: number, y: number, time: number): DragState => {
    measureSnaps();
    const holds = [holdLayer(panel.current), holdLayer(backdrop.current)];
    return {
      id,
      startY: y,
      startOffset: offset(),
      samples: [[y, time]],
      release: () => {
        for (const release of holds) release();
      },
    };
  };

  const moveDrag = (state: DragState, y: number, time: number) => {
    const top = Math.min(...snapOffsets.current);
    let next = state.startOffset + (y - state.startY);
    if (next < top) next = top - rubber(top - next);
    setChannel(panel.current, 'y', toPercent(next));
    setChannel(backdrop.current, 'opacity', backdropFor(next));
    state.samples.push([y, time]);
    if (state.samples.length > 8) state.samples.shift();
  };

  const endDrag = (state: DragState, y: number, time: number) => {
    state.release();
    const recent = state.samples.find(([, at]) => time - at <= 100) ?? state.samples.at(-1);
    const elapsed = recent ? (time - recent[1]) / 1000 : 0;
    const velocity = recent && elapsed >= 0.01 ? (y - recent[0]) / elapsed : 0;
    const current = offset();
    const projected = current + velocity * PROJECTION_S;
    const closed = height();
    const candidates = [...snapOffsets.current, closed];
    const nearest = candidates.reduce((best, candidate) =>
      Math.abs(candidate - projected) < Math.abs(best - projected) ? candidate : best,
    );
    const dismiss = nearest === closed || velocity > FLING_DISMISS;
    const target = dismiss ? closed : nearest;
    void animateChannel(panel.current, 'y', toPercent(target), 'smooth', toPercent(velocity));
    void animateChannel(backdrop.current, 'opacity', dismiss ? 0 : 1, 'smooth');
    if (dismiss) onCloseRef.current();
  };

  const handleProps = {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = startDrag(event.pointerId, event.clientY, event.timeStamp);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = drag.current;
      if (state?.id === event.pointerId) moveDrag(state, event.clientY, event.timeStamp);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = drag.current;
      drag.current = null;
      if (state?.id === event.pointerId) endDrag(state, event.clientY, event.timeStamp);
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = drag.current;
      drag.current = null;
      if (state?.id === event.pointerId) endDrag(state, state.startY, event.timeStamp);
    },
  };

  // Scroll hand-off (touch): at the top of the content, pulling down drags the sheet instead of scrolling.
  useEffect(() => {
    const content = scroller.current;
    if (!mounted || !content) return;
    let start: { y: number; x: number } | null = null;
    let decided: 'scroll' | 'drag' | null = null;
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch) return;
      start = { y: touch.clientY, x: touch.clientX };
      decided = null;
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!start || !touch) return;
      if (decided === null) {
        const dy = touch.clientY - start.y;
        if (Math.abs(dy) < 6) return;
        decided = dy > 0 && content.scrollTop <= 0 ? 'drag' : 'scroll';
        if (decided === 'drag') drag.current = startDrag(-1, start.y, event.timeStamp);
      }
      if (decided !== 'drag') return;
      event.preventDefault();
      const state = drag.current;
      if (state) moveDrag(state, touch.clientY, event.timeStamp);
    };
    const onEnd = (event: TouchEvent) => {
      const state = drag.current;
      const touch = event.changedTouches[0];
      if (decided === 'drag' && state && touch) {
        drag.current = null;
        endDrag(state, touch.clientY, event.timeStamp);
      }
      start = null;
      decided = null;
    };
    content.addEventListener('touchstart', onStart, { passive: true });
    content.addEventListener('touchmove', onMove, { passive: false });
    content.addEventListener('touchend', onEnd);
    content.addEventListener('touchcancel', onEnd);
    return () => {
      content.removeEventListener('touchstart', onStart);
      content.removeEventListener('touchmove', onMove);
      content.removeEventListener('touchend', onEnd);
      content.removeEventListener('touchcancel', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers read refs; re-bind per mount only
  }, [mounted]);

  if (!mounted) return null;
  const full = snaps.includes('full');
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Esc: animate out through the normal close path instead of the browser's instant close.
        event.preventDefault();
        onCloseRef.current();
      }}
      onClose={() => {
        // The browser may still close the dialog itself (a repeated Esc). Stay in sync without animating.
        if (closing.current) return;
        closing.current = true;
        setMounted(false);
        onCloseRef.current();
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 backdrop:bg-transparent"
    >
      {/* Tapping outside closes; keyboard users have Esc and the close button. */}
      <div
        ref={backdrop}
        aria-hidden
        onClick={() => {
          onCloseRef.current();
        }}
        className="absolute inset-0 bg-overlay opacity-0"
      />
      <div
        ref={panel}
        data-sheet
        className={`absolute inset-x-0 bottom-0 mx-auto flex max-h-[90dvh] max-w-content flex-col rounded-t-xl bg-surface shadow-e2 [transform:translateY(100%)] ${
          full ? 'h-[90dvh]' : ''
        }`}
      >
        <div data-sheet-handle className="shrink-0 touch-none select-none" {...handleProps}>
          <div className="flex justify-center pt-2 pb-1" aria-hidden>
            <span className="h-1.5 w-9 rounded-full bg-border" />
          </div>
          <div className="flex min-h-12 items-center gap-2 px-screen pb-2">
            <h2
              ref={heading}
              id={titleId}
              tabIndex={-1}
              className="min-w-0 flex-1 truncate type-headline text-text outline-none"
            >
              {title}
            </h2>
            {closeButton ? (
              <IconButton
                label={t('nav.close')}
                icon={<XIcon size={20} />}
                variant="tinted"
                onPress={() => {
                  onCloseRef.current();
                }}
                className="-me-2"
              />
            ) : null}
          </div>
        </div>
        <div ref={scroller} data-sheet-scroll className="scroller min-h-0 flex-1 px-screen pb-4">
          {children}
        </div>
        {footer ? <div className="shrink-0 border-t border-border px-screen pt-3 pb-safe">{footer}</div> : null}
        {footer ? null : <div className="shrink-0 pb-safe" />}
      </div>
    </dialog>
  );
}
