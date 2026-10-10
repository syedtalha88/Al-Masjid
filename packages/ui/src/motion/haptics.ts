import { useCallback, useSyncExternalStore } from 'react';

/** Vibration patterns, ms (08 §7). */
export const HAPTICS = {
  selection: 8,
  impactLight: 12,
  success: [15, 40, 15],
  warning: [30, 60, 30],
} as const satisfies Record<string, number | readonly number[]>;

export type HapticKind = keyof typeof HAPTICS;

interface VibrateTarget {
  vibrate?: (pattern: number | number[]) => boolean;
}

type Listener = () => void;

/**
 * Settings → "Vibration" (default on). Independent of reduced motion. Kept in memory for now; persisted in
 * the device store when Settings lands (PROGRESS F16).
 */
const setting = {
  enabled: true,
  listeners: new Set<Listener>(),
};

export function setHapticsEnabled(enabled: boolean): void {
  if (setting.enabled === enabled) return;
  setting.enabled = enabled;
  for (const listener of setting.listeners) listener();
}

export function isHapticsEnabled(): boolean {
  return setting.enabled;
}

/**
 * Plays a haptic pattern via `navigator.vibrate` (Android). iOS has no web haptics API → no-op.
 *
 * @returns true when a vibration was requested.
 */
export function haptic(kind: HapticKind, target?: VibrateTarget): boolean {
  // `navigator` is absent outside browsers (SSR, tests).
  const device: VibrateTarget | undefined = target ?? (typeof navigator === 'undefined' ? undefined : navigator);
  if (!setting.enabled || typeof device?.vibrate !== 'function') return false;
  const pattern = HAPTICS[kind];
  try {
    return device.vibrate(typeof pattern === 'number' ? pattern : [...pattern]);
  } catch {
    return false;
  }
}

function subscribe(listener: Listener): () => void {
  setting.listeners.add(listener);
  return () => setting.listeners.delete(listener);
}

/** The Vibration setting + a trigger bound to it (for the Settings toggle and components). */
export function useHaptics() {
  const enabled = useSyncExternalStore(subscribe, isHapticsEnabled, () => true);
  const trigger = useCallback((kind: HapticKind) => haptic(kind), []);
  return { enabled, setEnabled: setHapticsEnabled, trigger } as const;
}
