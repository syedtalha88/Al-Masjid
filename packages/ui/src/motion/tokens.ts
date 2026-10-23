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

/**
 * The same spring as a physics spring (`stiffness`/`damping`/`mass`). Motion treats `visualDuration`/`bounce`
 * springs as time-defined and ignores any starting velocity (Motion 14), so animations that must carry a
 * velocity — swipe releases and interrupted navigation (08 §1.2, §3.2) — use this form. Same conversion as
 * Motion's own (`stiffness = (2π / (1.2 · visualDuration))²`, damping ratio `1 − bounce`); proven equal by test.
 *
 * @param token - a spring token with `bounce >= 0`.
 * @returns a Motion spring transition that honours `velocity`.
 */
export function springPhysics(token: (typeof spring)[SpringToken]) {
  const dampingRatio = 1 - token.bounce;
  const stiffness = ((2 * Math.PI) / (token.visualDuration * 1.2)) ** 2;
  return {
    type: 'spring',
    stiffness,
    damping: 2 * dampingRatio * Math.sqrt(stiffness),
    mass: 1,
  } as const satisfies Transition;
}

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
  /** Onboarding welcome illustration: line draw-in once (08 §5.11). */
  drawIn: { duration: 1.2, ease: [0.32, 0.72, 0, 1] },
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

/** Looping indicators (CSS keyframes in `motion.css`). Spinners keep turning with reduced motion (functional). */
export const loop = {
  /** One spinner revolution, ms. */
  spinnerMs: 800,
  /** One skeleton shimmer sweep, ms (static skeleton with reduced motion, 08 §6). */
  shimmerMs: 1400,
  /** Countdown "soon" dot: one soft pulse, ms (08 §5.5); static with reduced motion. */
  pulseMs: 1200,
  /** Scanner corner brackets breathe 1 ↔ `scanBreatheScale` (08 §5.8); off with reduced motion. */
  scanBreatheMs: 1600,
  scanBreatheScale: 1.03,
  /** Scanner line: one sweep across the window, ms (then back); off with reduced motion. */
  scanSweepMs: 1800,
} as const;

/** Form feedback (08 §5.10): an invalid field shakes x 0 → −6 → 6 → −3 → 0 px. */
export const feedback = {
  shakeMs: 300,
  shakePx: [0, -6, 6, -3, 0],
  /** Toasts auto-dismiss after this (08 §5.10); persistent toasts (update available) wait for an action. */
  toastMs: 3000,
  /** Tap ripple (Ameen 08 §5.6, NumberPad keys §5.12): scale 0 → 2.4, opacity 0.35 → 0. */
  rippleMs: 500,
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

/** Stack navigator geometry (08 §3.1, §3.4). */
export const navigation = {
  /** Covered screen parallax: x 0 → −28% (mirrored in RTL). */
  coveredOffsetPct: 28,
  /** Dim over the covered screen. */
  coveredDim: 0.06,
  /** Modal presentation: app scales to 0.94, corners 16px, dim 0.3 (not in lite motion). */
  modalBackgroundScale: 0.94,
  modalBackgroundRadiusPx: 16,
  modalDim: 0.3,
  /** Screens kept mounted per stack; deeper ones unmount and restore scroll from cache. */
  maxMounted: 3,
  /** Horizontal movement before an edge drag becomes a swipe-back (vertical wins otherwise). */
  swipeActivatePx: 10,
  /** Release-velocity window for swipe commits, ms. */
  velocityWindowMs: 100,
  /** Without requestIdleCallback (Safari), tab-root code is preloaded this long after start, ms. */
  idlePreloadDelayMs: 1500,
} as const;

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
  /** Pull-to-refresh (08 §4): content follows `distance ^ pullExponent`; past `pullRefreshPx` a release refreshes and the
   *  content waits at `pullHoldPx` until the data settles. */
  pullExponent: 0.7,
  pullRefreshPx: 72,
  pullHoldPx: 56,
} as const;
