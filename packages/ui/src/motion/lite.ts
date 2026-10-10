import { useSyncExternalStore } from 'react';

/**
 * "Lite motion" (08 §6): on low-end devices, or after the session shows repeated jank, expensive effects are
 * dropped (shared-element morphs, modal background scale, hero parallax scale, list stagger). Cheap
 * transforms stay (push/pop, sheets, tabs, press feedback). The user never sees this switch.
 */

export interface DeviceHints {
  readonly hardwareConcurrency?: number | undefined;
  /** Chromium only (`navigator.deviceMemory`, GB). */
  readonly deviceMemory?: number | undefined;
}

/** `hardwareConcurrency <= 4` and (`deviceMemory <= 3` or unknown). Unknown core count → not low-end. */
export function isLowEndDevice(hints: DeviceHints): boolean {
  const { hardwareConcurrency: cores, deviceMemory: memory } = hints;
  return cores !== undefined && cores <= 4 && (memory === undefined || memory <= 3);
}

export const JANK = {
  /** A frame this long (≈ 3 frames at 60 Hz) during an animation starts a dropped-frame burst. */
  burstFrameMs: 50,
  /** Bursts per session that switch lite motion on. */
  burstsForLite: 3,
} as const;

type Listener = () => void;

/** Session store: has jank already switched lite motion on? */
const session = {
  jankLite: false,
  listeners: new Set<Listener>(),
  set(value: boolean) {
    if (session.jankLite === value) return;
    session.jankLite = value;
    for (const listener of session.listeners) listener();
  },
};

export interface FrameClock {
  readonly now: () => number;
  readonly requestFrame: (callback: (time: number) => void) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly hidden: () => boolean;
}

const browserClock = (): FrameClock => ({
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => {
    cancelAnimationFrame(handle);
  },
  hidden: () => document.hidden,
});

/**
 * Dropped-frame burst detector. Call `watch()` when an animation/gesture starts and the returned function
 * when it ends; frames are only measured while something is moving (idle pages are not jank). Consecutive
 * slow frames count as one burst. After `JANK.burstsForLite` bursts, `onLite` fires once.
 */
export class JankMonitor {
  #bursts = 0;
  #fired = false;
  readonly #onLite: () => void;
  readonly #clock: FrameClock;

  constructor(onLite: () => void, clock: FrameClock = browserClock()) {
    this.#onLite = onLite;
    this.#clock = clock;
  }

  get bursts(): number {
    return this.#bursts;
  }

  watch(): () => void {
    let last = this.#clock.now();
    let inBurst = false;
    let handle = 0;
    let active = true;
    const frame = (time: number) => {
      if (!active) return;
      const delta = time - last;
      last = time;
      if (this.#clock.hidden()) {
        inBurst = false;
      } else if (delta >= JANK.burstFrameMs) {
        if (!inBurst) this.#recordBurst();
        inBurst = true;
      } else {
        inBurst = false;
      }
      handle = this.#clock.requestFrame(frame);
    };
    handle = this.#clock.requestFrame(frame);
    return () => {
      active = false;
      this.#clock.cancelFrame(handle);
    };
  }

  #recordBurst() {
    this.#bursts += 1;
    if (!this.#fired && this.#bursts >= JANK.burstsForLite) {
      this.#fired = true;
      this.#onLite();
    }
  }
}

let sessionMonitor: JankMonitor | undefined;

/**
 * Measures frames while an animation runs; returns the stop function. Used by the navigator, sheets and
 * other large transitions (T0.9+).
 */
export function trackMotion(): () => void {
  if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return () => undefined;
  sessionMonitor ??= new JankMonitor(() => {
    session.set(true);
  });
  return sessionMonitor.watch();
}

function subscribe(listener: Listener): () => void {
  session.listeners.add(listener);
  return () => session.listeners.delete(listener);
}

const deviceIsLowEnd = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const hints = navigator as Navigator & { deviceMemory?: number };
  return isLowEndDevice({ hardwareConcurrency: hints.hardwareConcurrency, deviceMemory: hints.deviceMemory });
};

/** True when lite motion is on (low-end device, or jank detected this session). */
export function useLiteMotion(): boolean {
  const jank = useSyncExternalStore(
    subscribe,
    () => session.jankLite,
    () => false,
  );
  return jank || deviceIsLowEnd();
}

/** Test helper: reset the session state. */
export function resetLiteMotionSession(): void {
  sessionMonitor = undefined;
  session.set(false);
}
