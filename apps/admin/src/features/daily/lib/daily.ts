// B6 Hadith / Ayah (07 B6, 00 §4.3 Daily, PHASE_03 T3.7): the draft (a verified library entry and the masjid's
// optional note — no free-form hadith/ayah text), the publish body, the item the preview renders and the topic chips of
// the "Choose another" search.
import { type AdminLibraryEntry, DAILY_NOTE_MAX, type DailyContentPublish } from '@mc/shared/contracts';
import type { FeedItem } from '@mc/shared/contracts/public';

import type { ItemEditing } from '../../publish/use-publish.ts';

export type DailyKind = 'hadith' | 'ayah';
export const DAILY_KINDS: readonly DailyKind[] = ['hadith', 'ayah'];

export interface DailyDraft {
  readonly kind: DailyKind;
  readonly entry: AdminLibraryEntry;
  /** As typed; trimmed when published (empty = no note). */
  readonly note: string;
  /** The masjid already published one of this kind today — the preview repeats the warning. */
  readonly publishedToday: boolean;
  /** Set when the draft edits a published post (B12, T3.9): the last step saves instead of publishing. */
  readonly editing?: ItemEditing;
}

/** A new draft for the chosen entry. */
export function draftForEntry(kind: DailyKind, entry: AdminLibraryEntry, publishedToday: boolean): DailyDraft {
  return { kind, entry, note: '', publishedToday };
}

/** The note as published: trimmed, `undefined` when empty. */
export function noteOf(draft: DailyDraft): string | undefined {
  const note = draft.note.trim();
  return note === '' ? undefined : note;
}

/** The body of `POST /items/daily-content`; `null` when the note is too long (the field also stops at the limit). */
export function dailyPublishBody(draft: DailyDraft, notify: boolean): DailyContentPublish | null {
  const note = noteOf(draft);
  if (note !== undefined && note.length > DAILY_NOTE_MAX) return null;
  return { libraryId: draft.entry.id, ...(note === undefined ? {} : { note }), notify };
}

const PREVIEW_ID = 'previewDaily';

/** The item musallis will receive — the preview renders it in the Hadith & Quran "Today's" hero card. */
export function dailyPreviewItem(draft: DailyDraft, masjidId: string, now: Date): FeedItem {
  const note = noteOf(draft);
  const { entry } = draft;
  return {
    publicId: PREVIEW_ID,
    masjidId,
    type: 'daily_content',
    audience: 'everyone',
    isImportant: false,
    publishedAt: now.toISOString(),
    daily: {
      kind: draft.kind,
      ...(note === undefined ? {} : { note }),
      library: {
        id: entry.id,
        kind: entry.kind,
        arabic: entry.arabic,
        transliteration: entry.transliteration,
        translation: entry.translation,
        reference: entry.reference,
        sourceName: entry.sourceName,
        sourceLicense: entry.sourceLicense,
      },
    },
  };
}

/** Topic chips for the search: the most used tags among `entries`, then alphabetical; at most `max`. */
export function topicChips(entries: readonly AdminLibraryEntry[], max = 8): string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b))
    .slice(0, max)
    .map(([tag]) => tag);
}
