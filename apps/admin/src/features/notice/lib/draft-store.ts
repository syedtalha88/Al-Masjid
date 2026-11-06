// The B5 draft shared by Choose → Fill → Preview (`createDraftStore` — one draft in memory, lost on reload).
import { createDraftStore } from '../../publish/draft-store.ts';
import type { NoticeDraft } from './notice.ts';

const store = createDraftStore<NoticeDraft>();

/** Replaces the notice draft (`null` clears it after publishing). */
export const setNoticeDraft = store.set;
/** The current notice draft, re-rendering on every change. */
export const useNoticeDraft = store.useDraft;
