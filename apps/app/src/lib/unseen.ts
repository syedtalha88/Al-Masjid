// The Updates tab badge (07 A13): how many followed-masjid items are newer than the last Updates visit. Tiny on purpose
// — it lives in the app entry with the tab bar; Home and Updates (lazy) compute the count and set it here.
import { useSyncExternalStore } from 'react';

let count = 0;
const listeners = new Set<() => void>();

/** Sets the unseen count (≥ 0); the tab bar re-renders when it changes. */
export function setUnseenCount(next: number): void {
  const value = Math.max(0, Math.floor(next));
  if (value === count) return;
  count = value;
  for (const listener of listeners) listener();
}

/** The current unseen count (the Updates tab badge). */
export function useUnseenCount(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => count,
    () => count,
  );
}
