import type { TargetAndTransition, Transition } from 'motion/react';

import { tween } from './tokens.ts';

/** Enter/exit description for an element that appears and disappears (used with `AnimatePresence`). */
export interface Presence {
  readonly initial: TargetAndTransition;
  readonly animate: TargetAndTransition;
  readonly exit: TargetAndTransition;
  readonly transition: Transition;
}

/** The reduced-motion replacement for every movement: a short crossfade (08 §6). */
export const CROSSFADE: Presence = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: tween.fade,
};

/**
 * Returns `presence` with full motion, or `CROSSFADE` when reduced motion is on. Every moving presence in the
 * app goes through this so reduced motion is never forgotten.
 */
export function motionOrFade(reduced: boolean, presence: Presence): Presence {
  return reduced ? CROSSFADE : presence;
}
