import type { FeedItem, LibraryEntry, NoticeTemplate } from '@mc/shared/contracts/public';
import { describe, expect, it } from 'vitest';

import {
  announcementTags,
  ARCHIVE_AFTER_DAYS,
  duaPerson,
  filterAnnouncements,
  filterDuas,
  isArchived,
  libraryText,
  noticeMessage,
  splitArchived,
  templateArguments,
} from '../content-view.ts';

// Religious text: the 10 §5 placeholders only.
const LIBRARY: LibraryEntry = {
  id: '00000000-0000-4000-8000-0000000000aa',
  kind: 'dua',
  arabic: 'نص تجريبي للعرض فقط',
  transliteration: { en: 'Sample transliteration — DEV ONLY' },
  translation: {
    en: 'Sample translation text for development. Not a real hadith.',
    hi: 'विकास के लिए नमूना अनुवाद। यह वास्तविक हदीस नहीं है।',
  },
  reference: 'DEV-SAMPLE-001',
  sourceName: 'Development fixture',
  sourceLicense: 'N/A — not for production',
};

const NOW = new Date('2026-10-24T08:00:00.000Z');
const base = {
  masjidId: '00000000-0000-4000-8000-000000000001',
  audience: 'everyone',
  isImportant: false,
} as const;
let next = 0;
const item = (fields: Partial<FeedItem> & Pick<FeedItem, 'type'>): FeedItem => {
  next += 1;
  return {
    ...base,
    publicId: `item${String(next).padStart(8, '0')}`,
    publishedAt: '2026-10-23T10:00:00.000Z',
    ...fields,
  };
};
const dua = (
  category: 'illness' | 'inteqal' | 'other',
  fields: Partial<NonNullable<FeedItem['dua']>> = {},
  at?: string,
) =>
  item({
    type: 'dua_request',
    ...(at ? { publishedAt: at } : {}),
    dua: { category, namePrivate: true, ...fields },
  });

describe('libraryText (00 §4.3 fallback to English with a tag)', () => {
  it('uses the app language when present, else English flagged as a fallback', () => {
    expect(libraryText(LIBRARY, 'hi')).toEqual({
      translation: LIBRARY.translation.hi,
      fallback: false,
      transliteration: 'Sample transliteration — DEV ONLY',
    });
    expect(libraryText(LIBRARY, 'te')).toMatchObject({ translation: LIBRARY.translation.en, fallback: true });
    expect(libraryText(LIBRARY, 'en')).toMatchObject({ fallback: false });
    expect(libraryText({ ...LIBRARY, transliteration: { te: 'x' } }, 'te').transliteration).toBe('x');
    expect(libraryText({ ...LIBRARY, transliteration: {} }, 'hi').transliteration).toBeUndefined();
  });
});

describe('announcement tags and filters (07 A7)', () => {
  it('Important first, then the category', () => {
    expect(announcementTags(item({ type: 'announcement', isImportant: true }))).toEqual(['important', 'general']);
    expect(announcementTags(item({ type: 'announcement', announcement: { category: 'event' } }))).toEqual(['event']);
  });

  it('filters by category chip', () => {
    const items = [
      item({ type: 'announcement', announcement: { category: 'event' } }),
      item({ type: 'announcement' }),
      item({ type: 'announcement', announcement: { category: 'timing' } }),
    ];
    expect(filterAnnouncements(items, 'all')).toHaveLength(3);
    expect(filterAnnouncements(items, 'general')).toEqual([items[1]]);
    expect(filterAnnouncements(items, 'timing')).toEqual([items[2]]);
  });
});

describe('dua requests (07 A9, 00 §4.3)', () => {
  it('names the person only when the family allowed it', () => {
    expect(duaPerson(dua('illness', { namePrivate: false, personName: 'Test Person A' }))).toEqual({
      kind: 'named',
      name: 'Test Person A',
    });
    expect(duaPerson(dua('illness', { namePrivate: true }))).toEqual({ kind: 'private' });
    expect(duaPerson(dua('other', { namePrivate: false }))).toBeNull();
  });

  it('archives after 30 days, or when the server marked it', () => {
    const day = 24 * 60 * 60 * 1000;
    const old = new Date(NOW.getTime() - (ARCHIVE_AFTER_DAYS * day + 1)).toISOString();
    const recent = new Date(NOW.getTime() - (ARCHIVE_AFTER_DAYS * day - 60_000)).toISOString();
    expect(isArchived(dua('other', {}, old), NOW)).toBe(true);
    expect(isArchived(dua('other', {}, recent), NOW)).toBe(false);
    expect(isArchived(dua('other', { archivedAt: recent }, recent), NOW)).toBe(true);
    const items = [dua('illness', {}, recent), dua('inteqal', {}, old)];
    expect(splitArchived(items, NOW)).toEqual({ current: [items[0]], older: [items[1]] });
  });

  it('filters by category chip', () => {
    const items = [dua('illness'), dua('inteqal'), dua('other')];
    expect(filterDuas(items, 'inteqal')).toEqual([items[1]]);
    expect(filterDuas(items, 'all')).toHaveLength(3);
  });
});

describe('notice templates (02 §2: ICU body + typed params formatted per locale)', () => {
  const format = {
    time: (hhmm: string) => `T(${hhmm})`,
    date: (date: string) => `D(${date})`,
    prayer: (name: string) => `P(${name})`,
  };
  const template: NoticeTemplate = {
    key: 'k',
    category: 'timing',
    icon: 'clock',
    isImportantDefault: false,
    title: { en: 'Title', hi: 'शीर्षक', ur: '', te: 'శీర్షిక' },
    body: {
      en: '{prayer} at {time} from {from}; {hours_start}–{hours_end}; {n, plural, one {# day} other {# days}}; {who}',
      hi: '',
      ur: 'اردو {who}',
      te: '',
    },
    params: [
      { name: 'prayer', type: 'prayer', required: true },
      { name: 'time', type: 'time', required: true },
      { name: 'from', type: 'date', required: true },
      { name: 'hours', type: 'time_range', required: true },
      { name: 'n', type: 'number', required: true },
      { name: 'who', type: 'short_text', required: false },
    ],
    system: true,
  };

  it('formats each argument by its declared type; ranges become _start/_end', () => {
    expect(
      templateArguments(
        { prayer: 'isha', time: '21:15', from: '2026-10-24', hours: { start: '10:00', end: '14:00' }, n: 3, who: 'x' },
        template.params,
        format,
      ),
    ).toEqual({
      prayer: 'P(isha)',
      time: 'T(21:15)',
      from: 'D(2026-10-24)',
      hours_start: 'T(10:00)',
      hours_end: 'T(14:00)',
      n: 3,
      who: 'x',
    });
  });

  it('drops values that do not match their type (the message then falls back)', () => {
    expect(
      templateArguments(
        { prayer: 'lunch', time: '25:00', from: 'tomorrow', hours: '10:00', n: '3' },
        template.params,
        format,
      ),
    ).toEqual({});
  });

  it('picks the app language, else English', () => {
    expect(noticeMessage(template, 'ur')).toBe('اردو {who}');
    expect(noticeMessage(template, 'hi')).toBe(template.body.en);
  });
});
