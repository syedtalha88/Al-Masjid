// Small one-shot effects built on the motion tokens (08 §5.11) for screens outside the navigator.
import { animate } from 'motion/react';

import { feedback, loop, spring, tween } from './tokens.ts';

/** A running effect; `stop()` leaves the element in its final state. */
export interface Effect {
  stop(): void;
}

/**
 * Fades an element in with `tween.fade` (e.g. the onboarding content after a language change hides the LTR ↔ RTL
 * flip — 08 §5.11). Opacity only.
 */
export function crossfadeIn(element: HTMLElement): Effect {
  element.style.opacity = '0';
  const controls = animate(0, 1, {
    ...tween.fade,
    onUpdate: (value) => {
      element.style.opacity = String(value);
    },
  });
  return {
    stop() {
      controls.stop();
      element.style.opacity = '1';
    },
  };
}

/** Draws SVG strokes in once (`pathLength` 0 → 1, `tween.drawIn` — the onboarding welcome illustration). */
export function drawStrokesIn(elements: readonly SVGGeometryElement[]): Effect {
  if (elements.length === 0) return { stop: () => undefined };
  const controls = animate([...elements], { pathLength: [0, 1] }, tween.drawIn);
  return {
    stop() {
      controls.complete();
    },
  };
}

// The effects below animate a number and write the transform themselves (`animate(from, to, { onUpdate })`): the same
// small code path as `crossfadeIn`, which the app loads at start anyway — element animation would pull in more of
// Motion for lazy screens (measured +4 kB gz on the initial bundle, T2.5).

/** Invalid input: a short sideways shake (`feedback.shakePx` over `feedback.shakeMs`, 08 §5.10). Transform only. */
export function shake(element: HTMLElement): Effect {
  const keyframes: number[] = [...feedback.shakePx];
  const controls = animate(0, keyframes, {
    duration: feedback.shakeMs / 1000,
    ease: 'easeInOut',
    onUpdate: (x) => {
      element.style.transform = `translateX(${String(x)}px)`;
    },
  });
  return {
    stop() {
      controls.stop();
      element.style.transform = '';
    },
  };
}

/** Endless gentle scale pulse (scanner brackets, 08 §5.8). Callers skip it with reduced motion. */
export function breathe(element: HTMLElement): Effect {
  const controls = animate(1, loop.scanBreatheScale, {
    duration: loop.scanBreatheMs / 2000,
    ease: 'easeInOut',
    repeat: Number.POSITIVE_INFINITY,
    repeatType: 'mirror',
    onUpdate: (scale) => {
      element.style.transform = `scale(${String(scale)})`;
    },
  });
  return {
    stop() {
      controls.stop();
      element.style.transform = '';
    },
  };
}

/**
 * Endless sweep down `distancePx` and back (the scanner line, 08 §5.8). Callers skip it with reduced motion.
 *
 * @param distancePx - how far the element travels (the scan window height minus the line).
 */
export function sweep(element: HTMLElement, distancePx: number): Effect {
  const controls = animate(0, distancePx, {
    duration: loop.scanSweepMs / 1000,
    ease: 'easeInOut',
    repeat: Number.POSITIVE_INFINITY,
    repeatType: 'mirror',
    onUpdate: (y) => {
      element.style.transform = `translateY(${String(y)}px)`;
    },
  });
  return {
    stop() {
      controls.stop();
      element.style.transform = '';
    },
  };
}

/** Snaps an element from scale 1 to `scale` with `spring.snappy` (scanner brackets on a found code, 08 §5.8). */
export function snapTo(element: HTMLElement, scale: number): Effect {
  const controls = animate(1, scale, {
    ...spring.snappy,
    onUpdate: (value) => {
      element.style.transform = `scale(${String(value)})`;
    },
  });
  return {
    stop() {
      controls.stop();
      element.style.transform = '';
    },
  };
}
