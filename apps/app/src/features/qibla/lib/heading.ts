// The phone's heading for the Qibla page (07 A14, 08 §5.9, PHASE_07 T7.2): device-orientation events → heading
// (`headingFromOrientation`) → smoothed along the short way → one callback per reading, never React state. A phone
// without a compass (no absolute reading within 2 s) is reported once, and the page shows the bearing in degrees.
import { headingFromOrientation, smoothHeading } from '@mc/domain/qibla';

export type HeadingPlatform = 'ios' | 'android' | 'other';

/** No heading within this long → "no compass" (07 A14). */
export const NO_COMPASS_MS = 2000;
/** 08 §5.9: low-pass α ≈ 0.15 (reduced motion: 1 — no gliding). */
export const SMOOTHING = 0.15;

/**
 * Which heading rule applies: iOS (compass heading), Android (absolute alpha), anything else. iPadOS says "Macintosh"
 * but has touch points.
 */
export function headingPlatform(userAgent: string, maxTouchPoints = 0): HeadingPlatform {
  if (/iPhone|iPad|iPod/u.test(userAgent) || (/Macintosh/u.test(userAgent) && maxTouchPoints > 1)) return 'ios';
  return /Android/u.test(userAgent) ? 'android' : 'other';
}

/**
 * iOS needs `DeviceOrientationEvent.requestPermission()` from a tap before it sends events. (Chromium has the method
 * too but grants without asking — Android never shows the card.)
 */
export function needsMotionPermission(
  platform: HeadingPlatform,
  scope: { readonly DeviceOrientationEvent?: unknown },
): boolean {
  const ctor = scope.DeviceOrientationEvent as { requestPermission?: unknown } | undefined;
  return platform === 'ios' && typeof ctor?.requestPermission === 'function';
}

interface Timers {
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

/**
 * Starts listening. Android / others: `deviceorientationabsolute` (Chrome) and `deviceorientation` events that say
 * they are absolute; iOS: `deviceorientation` with `webkitCompassHeading`.
 *
 * @param input.screenAngle - the screen's rotation now (`screen.orientation.angle`).
 * @param input.onHeading - the smoothed heading, per reading.
 * @param input.onNoCompass - called once when no heading arrived within {@link NO_COMPASS_MS}.
 * @returns stop — removes every listener and the timer (on leave or when the page is hidden).
 */
export function listenHeading(input: {
  readonly target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  readonly platform: HeadingPlatform;
  readonly screenAngle: () => number;
  readonly factor: number;
  readonly onHeading: (heading: number) => void;
  readonly onNoCompass: () => void;
  readonly timers?: Timers;
}): () => void {
  const timers: Timers = input.timers ?? {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle) => {
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  };
  let smoothed: number | null = null;
  const onEvent = (event: Event) => {
    const reading = event as Event & {
      alpha?: number | null;
      absolute?: boolean;
      webkitCompassHeading?: number;
    };
    const absolute = event.type === 'deviceorientationabsolute' || reading.absolute === true;
    const heading = headingFromOrientation(
      { alpha: reading.alpha ?? null, absolute, webkitCompassHeading: reading.webkitCompassHeading },
      input.screenAngle(),
      input.platform,
    );
    if (heading === null) return;
    if (smoothed === null) timers.clearTimeout(timer);
    smoothed = smoothHeading(smoothed, heading, input.factor);
    input.onHeading(smoothed);
  };
  const types = input.platform === 'ios' ? ['deviceorientation'] : ['deviceorientationabsolute', 'deviceorientation'];
  for (const type of types) input.target.addEventListener(type, onEvent);
  const timer = timers.setTimeout(() => {
    if (smoothed === null) input.onNoCompass();
  }, NO_COMPASS_MS);
  return () => {
    timers.clearTimeout(timer);
    for (const type of types) input.target.removeEventListener(type, onEvent);
  };
}

/** A heading that changes per reading without React: `set` notifies subscribers (the dial writes its transform). */
export interface HeadingValue {
  get(): number;
  set(value: number): void;
  /** @returns unsubscribe. */
  on(event: 'change', listener: (value: number) => void): () => void;
}

/** 08 §5.9's "MotionValue" for the dial — a plain observable (the app does not depend on Motion directly). */
export function createHeadingValue(initial = 0): HeadingValue {
  let current = initial;
  const listeners = new Set<(value: number) => void>();
  return {
    get: () => current,
    set: (value) => {
      current = value;
      for (const listener of listeners) listener(value);
    },
    on: (_event, listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
