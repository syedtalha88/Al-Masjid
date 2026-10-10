import { gesture, navigation } from '../motion/tokens.ts';

/** A pointer sample: x in px (already in the swipe direction for RTL), time in ms. */
export type Sample = readonly [x: number, time: number];

export interface SwipeRelease {
  /** Pop (`true`) or spring back (`false`). */
  readonly commit: boolean;
  /** Release velocity in screen widths per second (positive = towards dismissal). */
  readonly progressVelocity: number;
}

/**
 * Decides what a released swipe-back does (08 §3.2). Velocity is measured over the last
 * `navigation.velocityWindowMs` of samples; under 10 ms of samples it is treated as event noise (0). Commits
 * on a flick faster than `gesture.dismissVelocity`, or past `gesture.dismissDistance` unless the finger is
 * flicking back towards the edge.
 *
 * @param samples - pointer samples since the swipe began, oldest first (direction-normalised x).
 * @param release - the release sample.
 * @param progress - how far the screen has travelled, 0–1.
 * @param width - viewport width in px.
 * @param cancelled - `pointercancel`: always springs back with no velocity.
 */
export function swipeRelease(
  samples: readonly Sample[],
  release: Sample,
  progress: number,
  width: number,
  cancelled: boolean,
): SwipeRelease {
  if (cancelled) return { commit: false, progressVelocity: 0 };
  const [x, time] = release;
  // No sample inside the window means the finger paused: measure from the latest one (≈ 0), not the oldest.
  const first = samples.find(([, at]) => time - at <= navigation.velocityWindowMs) ?? samples.at(-1);
  const elapsed = first ? (time - first[1]) / 1000 : 0;
  const velocity = first && elapsed >= 0.01 ? (x - first[0]) / elapsed : 0;
  const commit =
    velocity > gesture.dismissVelocity || (progress > gesture.dismissDistance && velocity > -gesture.dismissVelocity);
  return { commit, progressVelocity: velocity / width };
}
