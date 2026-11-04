// The B7 draft shared by Category → Details → Attach dua → Preview (`createDraftStore` — one draft in memory, lost on
// reload).
import { createDraftStore } from '../../publish/draft-store.ts';
import type { DuaDraft } from './dua.ts';

const store = createDraftStore<DuaDraft>();

/** Replaces the dua request draft (`null` clears it after publishing). */
export const setDuaDraft = store.set;
/** The current dua request draft, re-rendering on every change. */
export const useDuaDraft = store.useDraft;
