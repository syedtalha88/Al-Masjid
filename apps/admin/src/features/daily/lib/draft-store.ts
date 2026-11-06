// The B6 draft shared by Choose → Note → Preview (`createDraftStore` — one draft in memory, lost on reload).
import { createDraftStore } from '../../publish/draft-store.ts';
import type { DailyDraft } from './daily.ts';

const store = createDraftStore<DailyDraft>();

/** Replaces the hadith/ayah draft (`null` clears it after publishing). */
export const setDailyDraft = store.set;
/** The current hadith/ayah draft, re-rendering on every change. */
export const useDailyDraft = store.useDraft;
