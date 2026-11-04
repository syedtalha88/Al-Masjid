// The B5 draft shared by its three screens (Choose → Fill → Preview are pushed screens, so the phone's back button
// steps back through the flow): one draft in memory, read with `useSyncExternalStore`. Leaving the flow from Home
// starts a new draft; a reload loses it (the Fill and Preview screens then send the admin back to Choose).
import { useSyncExternalStore } from 'react';

import type { NoticeDraft } from './notice.ts';

let current: NoticeDraft | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Replaces the draft (`null` clears it after publishing). */
export function setNoticeDraft(draft: NoticeDraft | null): void {
  current = draft;
  for (const listener of listeners) listener();
}

/** The current draft, re-rendering on every change. */
export function useNoticeDraft(): NoticeDraft | null {
  return useSyncExternalStore(subscribe, () => current);
}
