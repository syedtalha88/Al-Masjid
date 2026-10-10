// Motion tokens (08 §2) — the only place durations, springs and easings are written. The `mc/no-adhoc-motion`
// lint rule rejects timing literals everywhere else. CSS versions of the springs are generated into
// `motion.css` (Motion's `spring()` → CSS `linear()`), so CSS-only transitions use the same physics.
import type { Transition } from 'motion/react';

/** Springs use Motion's `visualDuration` + `bounce` (closest to SwiftUI response/dampingFraction). */
export const spring = {
  /** Press feedback, toggles, chips, tab indicator, small state changes. */
  snappy: { type: 'spring', visualDuration: 0.25, bounce: 0 },
  /** Stack push/pop, sheets, modals, segmented thumb. */
  smooth: { type: 'spring', visualDuration: 0.38, bounce: 0 },
  /** Shared-element morphs, progress bars, large layout changes. */
  gentle: { type: 'spring', visualDuration: 0.55, bounce: 0 },
  /** Celebration only: success check, Ameen, follow confirmation, FAB release. */
  bouncy: { type: 'spring', visualDuration: 0.45, bounce: 0.28 },
} as const satisfies Record<string, Transition>;

export type SpringToken = keyof typeof spring;

/** Tweens (seconds). */
export const tween = {
  /** Crossfades and the reduced-motion replacement for every movement. */
  fade: { duration: 0.18, ease: [0.2, 0, 0, 1] },
  /** Tab content swap, tooltip. */
  quick: { duration: 0.12, ease: 'easeOut' },
  /** Amount count-up (08 §5.7). */
  countUp: { duration: 0.7, ease: 'easeOut' },
  /** SuccessCheck: circle draw, then check draw (08 §5.8). */
  drawCircle: { duration: 0.35, ease: 'easeOut' },
  drawCheck: { duration: 0.25, ease: 'easeOut', delay: 0.35 },
} as const satisfies Record<string, Transition>;

/** CSS-only transitions (banners, skeleton → content, image fade-in). */
export const css = {
  ios: {
    easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
    durationMs: 400,
    /** `transition` shorthand for the given properties, e.g. `css.ios.transition('opacity')`. */
    transition: (...properties: readonly string[]) =>
      properties.map((property) => `${property} 400ms cubic-bezier(0.32, 0.72, 0, 1)`).join(', '),
  },
  /** Image placeholder → real image (08 §5.4). */
  imageInMs: 250,
} as const;

/** First-load list entrance: 30 ms per item for the first 8 items, then 0 (08 §2, §5.4). */
export const stagger = {
  stepS: 0.03,
  maxItems: 8,
  /** Delay in seconds for the item at `index`. */
  delay: (index: number): number => Math.min(Math.max(index, 0), 8) * 0.03,
} as const;

/** Pressed-state scale (08 §2). */
export const press = { button: 0.96, card: 0.98, fab: 0.92 } as const;
export type PressKind = keyof typeof press;

/** Gesture thresholds (08 §2, §5.1). */
export const gesture = {
  /** Swipe-back hit area from the leading edge, px. */
  edgeWidth: 24,
  /** Release velocity that commits a swipe/drag, px/s. */
  dismissVelocity: 500,
  /** Distance that commits a swipe/drag, fraction of width/height. */
  dismissDistance: 0.35,
  /** Pointer movement that turns a press into a scroll (cancels the press), px. */
  pressCancelDistance: 8,
  /** Long-press delay, ms. */
  longPressMs: 500,
} as const;
