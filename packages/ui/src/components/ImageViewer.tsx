import { thumbHashFromBase64, thumbHashToApproximateAspectRatio, thumbHashToRgba } from '@mc/domain/thumbhash';
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type WheelEvent,
} from 'react';

import { XIcon } from '../icons/glyph/XIcon.tsx';
import { useMotionPrefs } from '../motion/MotionProvider.tsx';
import { gesture } from '../motion/tokens.ts';
import { animateChannel, initLayer, setChannel } from '../navigation/driver.ts';
import { IconButton } from './Button.tsx';
import { wrapTab } from './focus.ts';
import {
  clampPan,
  doubleTap,
  fitInside,
  IDENTITY,
  rubberScale,
  settle,
  type Size,
  zoomAround,
  type ZoomState,
} from './zoom.ts';

export interface ImageViewerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The full-size photo; `null` shows the ThumbHash only (no media origin). */
  readonly src: string | null;
  readonly thumbhash?: string | undefined;
  /** Describes the photo. */
  readonly alt: string;
  /** "Close photo". */
  readonly closeLabel: string;
}

/** Wheel / keyboard zoom step. */
const STEP = 1.25;

function paintThumbhash(canvas: HTMLCanvasElement, base64: string): number | null {
  try {
    const hash = thumbHashFromBase64(base64);
    const { w, h, rgba } = thumbHashToRgba(hash);
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d');
    if (context) {
      const pixels = context.createImageData(w, h);
      pixels.data.set(rgba);
      context.putImageData(pixels, 0, 0);
    }
    return thumbHashToApproximateAspectRatio(hash);
  } catch {
    return null;
  }
}

/**
 * Full-screen photo viewer (07 A7 "tap → full-screen pinch-zoom viewer"): a native modal `<dialog>` on a dark stage.
 * Pinch (two fingers) zooms around the fingers with a rubber band past 1×/4×, one finger pans a zoomed photo,
 * double-tap zooms in/out at the tap, the wheel and `+`/`−`/`0` keys zoom on desktop. Releases settle with
 * `spring.smooth` — transform only. Esc or the close button closes; focus returns to the opener. Reduced motion:
 * fades only, zoom changes apply at once.
 */
export function ImageViewer({ open, onClose, src, thumbhash, alt, closeLabel }: ImageViewerProps) {
  const { reduced } = useMotionPrefs();
  const dialog = useRef<HTMLDialogElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(open);
  const [ratio, setRatio] = useState(16 / 10);
  const [stageSize, setStageSize] = useState<Size>({ width: 0, height: 0 });
  const zoom = useRef<ZoomState>(IDENTITY);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gestureStart = useRef<{ state: ZoomState; distance: number; mid: { x: number; y: number } } | null>(null);
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);

  if (open && !mounted) setMounted(true);

  const content = fitInside({ width: ratio, height: 1 }, stageSize);

  /** Writes a zoom state to the photo box (no animation). */
  const apply = useCallback(
    (state: ZoomState, animated: boolean) => {
      zoom.current = state;
      const node = box.current;
      if (!node || content.width === 0) return;
      const x = (state.x / content.width) * 100;
      const y = (state.y / content.height) * 100;
      if (animated && !reduced) {
        void animateChannel(node, 'scale', state.scale, 'smooth');
        void animateChannel(node, 'x', x, 'smooth');
        void animateChannel(node, 'y', y, 'smooth');
      } else {
        setChannel(node, 'scale', state.scale);
        setChannel(node, 'x', x);
        setChannel(node, 'y', y);
      }
    },
    [content.width, content.height, reduced],
  );

  useLayoutEffect(() => {
    const node = dialog.current;
    if (!open || !node) return;
    if (!node.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      node.showModal();
      close.current?.focus({ preventScroll: true });
      initLayer(backdrop.current, { opacity: 0 });
      initLayer(box.current, { opacity: 0, scale: 1, x: 0, y: 0 });
      zoom.current = IDENTITY;
    }
    void animateChannel(backdrop.current, 'opacity', 1, 'fade');
    void animateChannel(box.current, 'opacity', 1, 'fade');
  }, [open, mounted]);

  useEffect(() => {
    if (open || !mounted) return;
    void Promise.all([
      animateChannel(backdrop.current, 'opacity', 0, 'fade'),
      animateChannel(box.current, 'opacity', 0, 'fade'),
    ]).then((done) => {
      if (!done.every(Boolean)) return;
      dialog.current?.close();
      setMounted(false);
      const target = opener.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when asked to close
  }, [open]);

  // The stage size decides the fitted photo size (rotation, resize).
  useLayoutEffect(() => {
    const node = stage.current;
    if (!mounted || !node) return;
    const measure = () => {
      setStageSize({ width: node.clientWidth, height: node.clientHeight });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => {
        window.removeEventListener('resize', measure);
      };
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [mounted]);

  useLayoutEffect(() => {
    if (!mounted || !canvas.current || !thumbhash) return;
    const approximate = paintThumbhash(canvas.current, thumbhash);
    if (approximate) setRatio(approximate);
  }, [mounted, thumbhash]);

  const centre = (x: number, y: number) => {
    const rect = stage.current?.getBoundingClientRect();
    return rect ? { x: x - rect.left - rect.width / 2, y: y - rect.top - rect.height / 2 } : { x: 0, y: 0 };
  };

  const beginGesture = () => {
    const points = [...pointers.current.values()];
    const [a, b] = points;
    if (!a) {
      gestureStart.current = null;
      return;
    }
    const mid = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a;
    gestureStart.current = { state: zoom.current, distance: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0, mid };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    beginGesture();
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const start = gestureStart.current;
    if (!start) return;
    const [a, b] = [...pointers.current.values()];
    if (!a) return;
    if (b && start.distance > 0) {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = rubberScale(start.state.scale * (Math.hypot(a.x - b.x, a.y - b.y) / start.distance));
      const zoomed = zoomAround(start.state, scale, centre(start.mid.x, start.mid.y));
      apply({ ...zoomed, x: zoomed.x + mid.x - start.mid.x, y: zoomed.y + mid.y - start.mid.y }, false);
    } else if (start.state.scale > 1) {
      const panned = { ...start.state, x: start.state.x + a.x - start.mid.x, y: start.state.y + a.y - start.mid.y };
      apply(clampPan(panned, stageSize, content), false);
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = gestureStart.current;
    const single = pointers.current.size === 1;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size > 0) {
      beginGesture();
      return;
    }
    gestureStart.current = null;
    const moved = start ? Math.hypot(event.clientX - start.mid.x, event.clientY - start.mid.y) : 0;
    if (single && moved < gesture.pressCancelDistance) {
      const previous = lastTap.current;
      const now = event.timeStamp;
      if (
        previous &&
        now - previous.time < gesture.doubleTapMs &&
        Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < gesture.doubleTapSlopPx
      ) {
        lastTap.current = null;
        apply(doubleTap(zoom.current, centre(event.clientX, event.clientY), stageSize, content), true);
        return;
      }
      lastTap.current = { time: now, x: event.clientX, y: event.clientY };
    }
    apply(settle(zoom.current, stageSize, content), true);
  };

  const zoomBy = (factor: number, focus = { x: 0, y: 0 }) => {
    const next = zoomAround(zoom.current, Math.min(4, Math.max(1, zoom.current.scale * factor)), focus);
    apply(settle(next, stageSize, content), true);
  };

  if (!mounted) return null;
  return (
    // eslint-disable-next-line jsx-a11y-x/no-noninteractive-element-interactions -- the modal manages Tab (focus trap) and zoom keys
    <dialog
      ref={dialog}
      aria-label={alt}
      onKeyDown={(event: KeyboardEvent<HTMLDialogElement>) => {
        wrapTab(event, dialog.current);
        if (event.key === '+' || event.key === '=') zoomBy(STEP);
        else if (event.key === '-') zoomBy(1 / STEP);
        else if (event.key === '0') apply(IDENTITY, true);
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        setMounted(false);
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 backdrop:bg-transparent"
    >
      <div ref={backdrop} aria-hidden className="absolute inset-0 bg-text opacity-0" />
      <div
        ref={stage}
        role="presentation"
        data-image-stage
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(event: WheelEvent<HTMLDivElement>) => {
          zoomBy(event.deltaY < 0 ? STEP : 1 / STEP, centre(event.clientX, event.clientY));
        }}
        className="absolute inset-0 flex touch-none items-center justify-center select-none"
      >
        <div
          ref={box}
          data-image-box
          className="relative overflow-hidden opacity-0"
          style={{ width: content.width, height: content.height }}
        >
          {thumbhash ? <canvas ref={canvas} aria-hidden className="absolute inset-0 size-full" /> : null}
          {src ? (
            <img
              src={src}
              alt={alt}
              draggable={false}
              decoding="async"
              onLoad={(event) => {
                const image = event.currentTarget;
                if (image.naturalWidth > 0) setRatio(image.naturalWidth / image.naturalHeight);
              }}
              className="absolute inset-0 size-full object-contain"
            />
          ) : (
            <span role="img" aria-label={alt} className="absolute inset-0" />
          )}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 pt-safe">
        <div className="flex justify-end p-4">
          <IconButton
            ref={close}
            label={closeLabel}
            icon={<XIcon />}
            variant="onImage"
            className="pointer-events-auto"
            onPress={onClose}
          />
        </div>
      </div>
    </dialog>
  );
}
