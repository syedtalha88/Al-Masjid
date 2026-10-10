import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function mediaQuery(): MediaQueryList | undefined {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? undefined
    : window.matchMedia(QUERY);
}

function subscribe(onChange: () => void): () => void {
  const list = mediaQuery();
  list?.addEventListener('change', onChange);
  return () => list?.removeEventListener('change', onChange);
}

const getSnapshot = (): boolean => mediaQuery()?.matches ?? false;

/**
 * `prefers-reduced-motion: reduce`, live (re-renders when the OS setting changes). With it on, every
 * movement becomes a `tween.fade` crossfade; no parallax, pulses, count-ups or drawing (08 §6).
 */
export function useReducedMotionPref(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
