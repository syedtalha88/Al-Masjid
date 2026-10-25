// The "requests fail" half of the offline banner (01 §5.6): `navigator.onLine` stays true on a connected network
// without internet (common on patchy 4G and captive Wi-Fi), so the API client also reports whether the server answered.
// One failure shows the banner, the next real answer hides it; the browser's `online` event clears it too (the next
// request decides again).
import { useSyncExternalStore } from 'react';

let unreachable = false;
const listeners = new Set<() => void>();

const set = (value: boolean) => {
  if (unreachable === value) return;
  unreachable = value;
  for (const listener of listeners) listener();
};

/** Called by the API client: `true` when the server answered, `false` when a request got no answer. */
export function reportReachability(reachable: boolean): void {
  set(!reachable);
}

/** True after a request got no answer, until the next one that did. */
export const isServerUnreachable = (): boolean => unreachable;

/** Calls `listener` whenever the state changes. @returns the unsubscribe function. */
export function subscribeReachability(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    set(false);
  });
}

/** React: whether the server is currently unreachable (for the offline banner). */
export function useServerUnreachable(): boolean {
  return useSyncExternalStore(subscribeReachability, isServerUnreachable, () => false);
}

/** Test helper. */
export function resetReachability(): void {
  set(false);
}
