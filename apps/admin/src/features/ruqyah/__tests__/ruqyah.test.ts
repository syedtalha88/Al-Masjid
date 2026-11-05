import { type AdminLibraryEntry, type AdminRuqyahEntry, ruqyahSaveSchema } from '@mc/shared/contracts';
import { describe, expect, it } from 'vitest';

import {
  draftBody,
  draftDirty,
  draftIssues,
  draftOf,
  emptyDraft,
  groupByCategory,
  orderAfterMove,
  previewEntry,
  type RuqyahDraft,
} from '../lib/ruqyah.ts';

// 07 B15 (PHASE_03 T3.15): what each source needs before Save, the bodies (they pass the server contract), the preview
// card's entry (masjid text never carries a library source), and moves inside a heading. Fake texts only (10 §5).

const ARABIC = 'نص تجريبي للعرض فقط';
const MASJID = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const LIBRARY: AdminLibraryEntry = {
  id: '0b7f6c2e-1d4a-4f3b-9c8e-000000000001',
  kind: 'dua',
  arabic: ARABIC,
  transliteration: {},
  translation: { en: 'Sample translation text for development.' },
  reference: 'DEV-SAMPLE-001',
  sourceName: 'Development fixture',
  sourceLicense: 'N/A — not for production',
  tags: ['shifa'],
  duaCategory: 'illness',
};
const draft = (patch: Partial<RuqyahDraft>): RuqyahDraft => ({ ...emptyDraft('en'), category: 'nazar', ...patch });
const entry = (id: number, category: AdminRuqyahEntry['category']): AdminRuqyahEntry => ({
  id: `0b7f6c2e-1d4a-4f3b-9c8e-00000000010${String(id)}`,
  category,
  source: 'text',
  text: { arabic: ARABIC, translation: `Sample ${String(id)}`, translationLocale: 'en' },
});

describe('draft → body', () => {
  it('a new draft needs a source and a heading', () => {
    expect(draftIssues(emptyDraft('hi'))).toEqual(['source', 'category']);
    expect(draftBody(emptyDraft('hi'))).toBeNull();
  });

  it('library: the chosen verified entry', () => {
    expect(draftIssues(draft({ source: 'library' }))).toEqual(['library']);
    const body = draftBody(draft({ source: 'library', library: LIBRARY, title: '  Sample  ' }));
    expect(body).toEqual({ category: 'nazar', source: 'library', libraryId: LIBRARY.id, title: 'Sample' });
    expect(ruqyahSaveSchema.safeParse(body).success).toBe(true);
  });

  it('text: Arabic and a translation in a stated language; reference and instruction optional', () => {
    expect(draftIssues(draft({ source: 'text', arabic: ARABIC }))).toEqual(['translation']);
    const body = draftBody(
      draft({
        source: 'text',
        arabic: ARABIC,
        translation: 'Sample masjid text',
        translationLocale: 'ur',
        instructions: 'After Fajr',
        instructionsLocale: 'hi',
      }),
    );
    expect(body).toEqual({
      category: 'nazar',
      source: 'text',
      text: { arabic: ARABIC, translation: 'Sample masjid text', translationLocale: 'ur' },
      instructions: { text: 'After Fajr', locale: 'hi' },
    });
    expect(ruqyahSaveSchema.safeParse(body).success).toBe(true);
  });

  it('audio: a recording and its title; the body carries the ownership tick', () => {
    const voice = {
      key: `m/${MASJID}/a/0b7f6c2e-1d4a-4f3b-9c8e-000000000009`,
      durationS: 90,
      peaks: [1, 2],
      url: null,
    };
    expect(draftIssues(draft({ source: 'audio', voice }))).toEqual(['title']);
    expect(draftIssues(draft({ source: 'audio', title: 'Sample' }))).toEqual(['voice']);
    const body = draftBody(draft({ source: 'audio', voice, title: 'Sample recording' }));
    expect(body).toMatchObject({ source: 'audio', title: 'Sample recording', audio: { rightsConfirmed: true } });
    expect(ruqyahSaveSchema.safeParse(body).success).toBe(true);
  });

  it('a saved entry round-trips, so an untouched edit is not dirty', () => {
    const saved: AdminRuqyahEntry = {
      ...entry(1, 'shifa'),
      title: 'Sample',
      instructions: 'Sample',
      instructionsLocale: 'te',
    };
    const asDraft = draftOf(saved, 'en');
    expect(draftDirty(asDraft, asDraft)).toBe(false);
    expect(draftDirty(asDraft, { ...asDraft, category: 'general' })).toBe(true);
  });
});

describe('preview', () => {
  it('masjid text has no library source; a library entry shows the public library fields only', () => {
    const text = previewEntry(draft({ source: 'text', arabic: ARABIC, translation: 'Sample' }));
    expect(text).toMatchObject({ source: 'text' });
    expect(text).not.toHaveProperty('library');
    const library = previewEntry(draft({ source: 'library', library: LIBRARY }));
    expect(library?.library).toMatchObject({ sourceName: 'Development fixture' });
    expect(library?.library).not.toHaveProperty('tags');
    expect(previewEntry(draft({ source: 'audio' }))).toBeNull();
  });
});

describe('grouping and order', () => {
  const entries = [entry(1, 'general'), entry(2, 'nazar'), entry(3, 'general'), entry(4, 'nazar')];

  it('groups in A19 order', () => {
    expect(groupByCategory(entries).map((group) => group.category)).toEqual(['nazar', 'general']);
  });

  it('a move inside a heading yields the whole list, headings in order', () => {
    const ids = entries.map((item) => item.id);
    expect(orderAfterMove(entries, 'general', 1, 0)).toEqual([ids[1], ids[3], ids[2], ids[0]]);
    expect(orderAfterMove(entries, 'general', 0, 5)).toBeNull();
    expect(orderAfterMove(entries, 'shifa', 0, 1)).toBeNull();
  });
});
