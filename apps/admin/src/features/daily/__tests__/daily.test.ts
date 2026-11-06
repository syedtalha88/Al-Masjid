import { type AdminLibraryEntry, dailyContentPublishSchema } from '@mc/shared/contracts';
import { describe, expect, it } from 'vitest';

import {
  type DailyDraft,
  dailyPreviewItem,
  dailyPublishBody,
  draftForEntry,
  noteOf,
  topicChips,
} from '../lib/daily.ts';

// 07 B6 (PHASE_03 T3.7): the draft, the publish body (it must pass the server's contract), the item the preview renders
// and the search's topic chips. Placeholder library entries only (10 §Fixtures).

const ENTRY: AdminLibraryEntry = {
  id: '0b7f6c2e-1d4a-4f3b-9c8e-2a1b3c4d5e6f',
  kind: 'hadith',
  arabic: 'نَصٌّ تجريبي للعرض فقط',
  transliteration: { en: 'Sample transliteration — DEV ONLY' },
  translation: { en: 'Sample translation text for development. Not a real hadith.' },
  reference: 'DEV-SAMPLE-001',
  sourceName: 'Development fixture',
  sourceLicense: 'N/A — not for production',
  tags: ['patience', 'family'],
};
const MASJID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const NOW = new Date('2026-11-04T06:30:00Z');
const withNote = (note: string): DailyDraft => ({ ...draftForEntry('hadith', ENTRY, false), note });

describe('daily drafts', () => {
  it('a new draft has no note and keeps the "already today" flag', () => {
    expect(draftForEntry('ayah', ENTRY, true)).toEqual({ kind: 'ayah', entry: ENTRY, note: '', publishedToday: true });
  });

  it('the note is trimmed; empty means none', () => {
    expect(noteOf(withNote('  Test note  '))).toBe('Test note');
    expect(noteOf(withNote(' \n '))).toBeUndefined();
  });
});

describe('dailyPublishBody', () => {
  it('the entry and the note pass the server contract; no note when empty', () => {
    const body = dailyPublishBody(withNote(' Test note '), true);
    expect(body).toEqual({ libraryId: ENTRY.id, note: 'Test note', notify: true });
    expect(dailyContentPublishSchema.safeParse(body).success).toBe(true);
    const bare = dailyPublishBody(withNote(''), false);
    expect(bare).toEqual({ libraryId: ENTRY.id, notify: false });
    expect(dailyContentPublishSchema.safeParse(bare).success).toBe(true);
  });

  it('is null when the note is over 200 characters', () => {
    expect(dailyPublishBody(withNote('x'.repeat(201)), false)).toBeNull();
    expect(dailyPublishBody(withNote('x'.repeat(200)), false)).not.toBeNull();
  });
});

describe('dailyPreviewItem', () => {
  it('is the item musallis receive: daily content of the kind with its library entry and note, published now', () => {
    const item = dailyPreviewItem(withNote('Test note'), MASJID, NOW);
    expect(item).toMatchObject({
      masjidId: MASJID,
      type: 'daily_content',
      audience: 'everyone',
      isImportant: false,
      publishedAt: NOW.toISOString(),
      daily: { kind: 'hadith', note: 'Test note', library: { id: ENTRY.id, reference: 'DEV-SAMPLE-001' } },
    });
    expect(item.daily?.library).not.toHaveProperty('tags');
    expect(dailyPreviewItem(withNote(''), MASJID, NOW).daily).not.toHaveProperty('note');
  });
});

describe('topicChips', () => {
  it('most used tags first, then alphabetical, at most max', () => {
    const tagged = (...tags: string[]): AdminLibraryEntry => ({ ...ENTRY, tags });
    const entries = [tagged('patience', 'family'), tagged('patience'), tagged('charity', 'family'), tagged('zeal')];
    expect(topicChips(entries)).toEqual(['family', 'patience', 'charity', 'zeal']);
    expect(topicChips(entries, 2)).toEqual(['family', 'patience']);
    expect(topicChips([])).toEqual([]);
  });
});
