// A draft shared by the pushed screens of one publish flow (B5 notice, B6 hadith/ayah — the phone's back button steps
// back through the flow): one draft in memory, read with `useSyncExternalStore`. Opening the flow from Home starts a
// new draft; a reload loses it (the later screens then send the admin back to the first step).
import { useSyncExternalStore } from 'react';

export interface DraftStore<Draft> {
  /** Replaces the draft (`null` clears it after publishing). */
  readonly set: (draft: Draft | null) => void;
  /** The current draft, re-rendering on every change. */
  readonly useDraft: () => Draft | null;
}

/** A new, empty draft store for one flow. */
export function createDraftStore<Draft>(): DraftStore<Draft> {
  let current: Draft | null = null;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    set: (draft) => {
      current = draft;
      for (const listener of listeners) listener();
    },
    useDraft: () => useSyncExternalStore(subscribe, () => current),
  };
}
