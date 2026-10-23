// Small one-shot effects built on the motion tokens (08 §5.11) for screens outside the navigator.
import { animate } from 'motion/react';

import { tween } from './tokens.ts';

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
