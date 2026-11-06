// B15 Ruqyah (07 B15, PHASE_03 T3.15): the editor's draft, the save body, what the preview shows, and the list grouped by
// heading with moves inside a heading. Pure functions; the server checks the same rules (a recording needs its title and
// the ownership tick, ≤ 50 entries, a verified library entry).
import type { Locale } from '@mc/i18n/locales';
import {
  type AdminLibraryEntry,
  type AdminRuqyahEntry,
  RUQYAH_ARABIC_MAX,
  RUQYAH_CATEGORIES,
  RUQYAH_INSTRUCTIONS_MAX,
  RUQYAH_REFERENCE_MAX,
  RUQYAH_TITLE_MAX,
  RUQYAH_TRANSLATION_MAX,
  type RuqyahCategory,
  type RuqyahSave,
} from '@mc/shared/contracts';
import type { RuqyahEntry } from '@mc/shared/contracts/public';

import type { AttachedVoice } from '../../voice/lib/voice.ts';

export type RuqyahSource = 'library' | 'text' | 'audio';

export interface RuqyahDraft {
  readonly source: RuqyahSource | null;
  readonly category: RuqyahCategory | null;
  readonly title: string;
  readonly library: AdminLibraryEntry | null;
  readonly arabic: string;
  readonly translation: string;
  readonly translationLocale: Locale;
  readonly reference: string;
  readonly voice: AttachedVoice | null;
  readonly instructions: string;
  readonly instructionsLocale: Locale;
}

/** A new entry: nothing chosen yet; texts in the admin's language. */
export const emptyDraft = (locale: Locale): RuqyahDraft => ({
  source: null,
  category: null,
  title: '',
  library: null,
  arabic: '',
  translation: '',
  translationLocale: locale,
  reference: '',
  voice: null,
  instructions: '',
  instructionsLocale: locale,
});

/** A saved entry as a draft (a library entry no longer verified comes back without `library` — pick another). */
export function draftOf(entry: AdminRuqyahEntry, locale: Locale): RuqyahDraft {
  return {
    ...emptyDraft(locale),
    source: entry.source,
    category: entry.category,
    title: entry.title ?? '',
    library: entry.library ?? null,
    arabic: entry.text?.arabic ?? '',
    translation: entry.text?.translation ?? '',
    translationLocale: entry.text?.translationLocale ?? locale,
    reference: entry.text?.reference ?? '',
    voice: entry.audio
      ? { key: entry.audio.key, durationS: entry.audio.durationS, peaks: entry.audio.peaks ?? [], url: null }
      : null,
    instructions: entry.instructions ?? '',
    instructionsLocale: entry.instructionsLocale ?? locale,
  };
}

export type RuqyahIssue =
  'source' | 'category' | 'library' | 'arabic' | 'translation' | 'reference' | 'voice' | 'title' | 'instructions';

const tooLong = (value: string, max: number) => value.trim().length > max;

/** What still keeps the draft from being saved (empty = ready). */
export function draftIssues(draft: RuqyahDraft): RuqyahIssue[] {
  const issues: RuqyahIssue[] = [];
  if (!draft.source) issues.push('source');
  if (!draft.category) issues.push('category');
  if (draft.source === 'library' && !draft.library) issues.push('library');
  if (draft.source === 'text') {
    if (draft.arabic.trim() === '' || tooLong(draft.arabic, RUQYAH_ARABIC_MAX)) issues.push('arabic');
    if (draft.translation.trim() === '' || tooLong(draft.translation, RUQYAH_TRANSLATION_MAX)) {
      issues.push('translation');
    }
    if (tooLong(draft.reference, RUQYAH_REFERENCE_MAX)) issues.push('reference');
  }
  if (draft.source === 'audio') {
    if (!draft.voice) issues.push('voice');
    if (draft.title.trim() === '') issues.push('title');
  }
  if (tooLong(draft.title, RUQYAH_TITLE_MAX)) issues.push('title');
  if (tooLong(draft.instructions, RUQYAH_INSTRUCTIONS_MAX)) issues.push('instructions');
  return issues;
}

const optional = (value: string) => {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/** The `POST` / `PATCH /ruqyah` body, or `null` while an issue remains. */
export function draftBody(draft: RuqyahDraft): RuqyahSave | null {
  if (draftIssues(draft).length > 0 || !draft.category) return null;
  const title = optional(draft.title);
  const instructions = optional(draft.instructions);
  const common = {
    category: draft.category,
    ...(title === undefined ? {} : { title }),
    ...(instructions === undefined ? {} : { instructions: { text: instructions, locale: draft.instructionsLocale } }),
  };
  switch (draft.source) {
    case 'library':
      return draft.library ? { ...common, source: 'library', libraryId: draft.library.id } : null;
    case 'text': {
      const reference = optional(draft.reference);
      return {
        ...common,
        source: 'text',
        text: {
          arabic: draft.arabic.trim(),
          translation: draft.translation.trim(),
          translationLocale: draft.translationLocale,
          ...(reference === undefined ? {} : { reference }),
        },
      };
    }
    case 'audio':
      return draft.voice && title !== undefined
        ? {
            ...common,
            title,
            source: 'audio',
            audio: {
              key: draft.voice.key,
              durationS: draft.voice.durationS,
              peaks: [...draft.voice.peaks],
              rightsConfirmed: true,
            },
          }
        : null;
    case null:
      return null;
  }
}

/** The draft as the musalli card renders it (the B15 preview), or `null` before there is anything to show. */
export function previewEntry(draft: RuqyahDraft): RuqyahEntry | null {
  const category = draft.category ?? 'general';
  const title = optional(draft.title);
  const instructions = optional(draft.instructions);
  const common = {
    id: '00000000-0000-4000-8000-000000000000',
    category,
    ...(title === undefined ? {} : { title }),
    ...(instructions === undefined ? {} : { instructions, instructionsLocale: draft.instructionsLocale }),
  };
  if (draft.source === 'library' && draft.library) {
    const { tags: _tags, duaCategory: _category, ...library } = draft.library;
    return { ...common, source: 'library', library };
  }
  if (draft.source === 'text' && draft.arabic.trim() !== '' && draft.translation.trim() !== '') {
    const reference = optional(draft.reference);
    return {
      ...common,
      source: 'text',
      text: {
        arabic: draft.arabic.trim(),
        translation: draft.translation.trim(),
        translationLocale: draft.translationLocale,
        ...(reference === undefined ? {} : { reference }),
      },
    };
  }
  if (draft.source === 'audio' && draft.voice) {
    return {
      ...common,
      source: 'audio',
      audio: { key: draft.voice.key, durationS: draft.voice.durationS, peaks: [...draft.voice.peaks] },
    };
  }
  return null;
}

/** The draft differs from the saved entry (a new entry: always). */
export function draftDirty(saved: RuqyahDraft, draft: RuqyahDraft): boolean {
  return JSON.stringify(draftBody(saved)) !== JSON.stringify(draftBody(draft));
}

/** Entries under their headings in A19's order (only non-empty ones), each in the masjid's order. */
export function groupByCategory<E extends { readonly category: RuqyahCategory }>(entries: readonly E[]) {
  return RUQYAH_CATEGORIES.map((category) => ({
    category,
    entries: entries.filter((entry) => entry.category === category),
  })).filter((group) => group.entries.length > 0);
}

/**
 * The whole list's order after moving one entry inside its heading (from → to, indexes within the heading): headings
 * in A19 order, so the saved order is the order musallis see. `null` when nothing moves.
 */
export function orderAfterMove(
  entries: readonly AdminRuqyahEntry[],
  category: RuqyahCategory,
  from: number,
  to: number,
): string[] | null {
  const groups = groupByCategory(entries).map((group) => ({ ...group, entries: [...group.entries] }));
  const group = groups.find((candidate) => candidate.category === category);
  const moved = group?.entries[from];
  if (!group || !moved || to < 0 || to >= group.entries.length || from === to) return null;
  group.entries.splice(from, 1);
  group.entries.splice(to, 0, moved);
  return groups.flatMap((candidate) => candidate.entries.map((entry) => entry.id));
}

/** A short line for the list: the title, else the start of the translation, else the library reference. */
export function entrySummary(entry: AdminRuqyahEntry): string {
  return entry.title ?? entry.text?.translation ?? entry.library?.reference ?? entry.libraryId ?? '';
}
