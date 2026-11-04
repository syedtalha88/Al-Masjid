import { type AdminItem, itemEditSchema, type NoticeTemplate } from '@mc/shared/contracts';
import type { FeedItem, LibraryEntry } from '@mc/shared/contracts/public';
import { describe, expect, it } from 'vitest';

import {
  canDelete,
  canEdit,
  dailyDraftOf,
  dailyEditBody,
  duaDraftOf,
  duaEditBody,
  noticeDraftOf,
  noticeEditBody,
} from '../lib/posts.ts';

// 07 B12 (PHASE_03 T3.9): which posts can be edited or deleted, a post back as the draft of its flow (marked `editing`,
// with a private name for the masjid), and the edit body (it must pass the server's contract). Fake texts and
// placeholder library entries only (10 §Fixtures).

const NOW = new Date('2026-11-04T06:30:00Z');
const MASJID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const LIBRARY: LibraryEntry = {
  id: '0b7f6c2e-1d4a-4f3b-9c8e-2a1b3c4d5e6f',
  kind: 'dua',
  arabic: 'نَصٌّ تجريبي للعرض فقط',
  transliteration: { en: 'Sample transliteration — DEV ONLY' },
  translation: { en: 'Sample translation text for development. Not a real dua.' },
  reference: 'DEV-SAMPLE-008',
  sourceName: 'Development fixture',
  sourceLicense: 'N/A — not for production',
};
const base = (item: Partial<FeedItem> & Pick<FeedItem, 'type'>, over: Partial<AdminItem> = {}): AdminItem => ({
  id: '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a',
  status: 'published',
  updatedAt: NOW.toISOString(),
  editableUntil: '2026-11-05T06:30:00.000Z',
  item: {
    publicId: 'p1',
    masjidId: MASJID,
    audience: 'everyone',
    isImportant: false,
    publishedAt: NOW.toISOString(),
    ...item,
  },
  ...over,
});
const NOTICE = base({
  type: 'announcement',
  title: 'Test title',
  body: 'Test body',
  contentLocale: 'te',
  announcement: { category: 'event', eventAt: '2026-11-10T13:30:00.000Z' },
  image: { key: `m/${MASJID}/0b7f6c2e-1d4a-4f3b-9c8e-2a1b3c4d5e6f`, thumbhash: 'AAAA' },
});
const DUA = base(
  {
    type: 'dua_request',
    body: 'Test message',
    contentLocale: 'hi',
    dua: {
      category: 'inteqal',
      namePrivate: true,
      janazaAt: '2026-11-04T11:30:00.000Z',
      janazaPlace: 'Test place',
      library: LIBRARY,
    },
  },
  { privateName: 'Testperson Private' },
);

describe('canEdit / canDelete', () => {
  it('editable within the window for notices, hadith/ayah and duas with their library entry', () => {
    expect(canEdit(NOTICE, NOW)).toBe(true);
    expect(canEdit(NOTICE, new Date('2026-11-05T06:30:00Z'))).toBe(false);
    expect(canEdit(base({ type: 'announcement' }, { editableUntil: undefined }), NOW)).toBe(false);
    expect(canEdit(base({ type: 'daily_content', daily: { kind: 'hadith' } }), NOW)).toBe(false); // entry retired
    expect(canEdit(base({ type: 'timing_update' }), NOW)).toBe(false);
    expect(canDelete(NOTICE)).toBe(true);
    expect(canDelete({ ...NOTICE, status: 'deleted' })).toBe(false);
  });
});

describe('drafts from posts', () => {
  it('a notice: own text, event slots in IST, the photo by key (ThumbHash thumbnail), editing', () => {
    expect(noticeDraftOf(NOTICE)).toMatchObject({
      content: { kind: 'text', title: 'Test title', body: 'Test body', locale: 'te' },
      category: 'event',
      eventDate: '2026-11-10',
      eventTime: '19:00',
      photo: { key: NOTICE.item.image?.key, thumbhash: 'AAAA', url: null },
      editing: { itemId: NOTICE.id, updatedAt: NOW.toISOString() },
    });
    const template = base({
      type: 'announcement',
      templateKey: 'no_water_time_range',
      templateParams: { hours: { start: '10:00', end: '14:00' } },
      announcement: { category: 'facilities' },
    });
    expect(noticeDraftOf(template)?.content).toEqual({
      kind: 'template',
      key: 'no_water_time_range',
      values: { hours: { start: '10:00', end: '14:00' } },
    });
    expect(noticeDraftOf(DUA)).toBeNull();
  });

  it('a hadith with its note; a dua request with the private name (the masjid only), janaza slots', () => {
    const daily = base({
      type: 'daily_content',
      daily: { kind: 'hadith', note: 'Test note', library: { ...LIBRARY, kind: 'hadith' } },
    });
    expect(dailyDraftOf(daily)).toMatchObject({
      kind: 'hadith',
      note: 'Test note',
      entry: { id: LIBRARY.id, tags: [] },
    });
    expect(dailyDraftOf(NOTICE)).toBeNull();
    expect(duaDraftOf(DUA)).toMatchObject({
      category: 'inteqal',
      locale: 'hi',
      messageKey: null,
      message: 'Test message',
      personName: 'Testperson Private',
      namePrivate: true,
      janazaDate: '2026-11-04',
      janazaTime: '17:00',
      janazaPlace: 'Test place',
      editing: { itemId: DUA.id },
    });
  });
});

describe('edit bodies', () => {
  it('pass the server contract and never carry "notify"', () => {
    const template: NoticeTemplate | undefined = undefined;
    const notice = noticeDraftOf(NOTICE);
    const daily = dailyDraftOf(
      base({ type: 'daily_content', daily: { kind: 'hadith', library: { ...LIBRARY, kind: 'hadith' } } }),
    );
    const dua = duaDraftOf(DUA);
    if (!notice || !daily || !dua) throw new Error('drafts expected');
    const bodies = [noticeEditBody(notice, template), dailyEditBody(daily), duaEditBody(dua)];
    expect(bodies.map((body) => body?.type)).toEqual(['announcement', 'daily_content', 'dua_request']);
    for (const body of bodies) {
      expect(body).not.toHaveProperty('notify');
      expect(itemEditSchema.safeParse(body).success).toBe(true);
    }
    expect(
      noticeEditBody({ ...notice, content: { kind: 'text', title: '', body: '', locale: 'en' } }, template),
    ).toBeNull();
    expect(dailyEditBody({ ...daily, note: 'x'.repeat(201) })).toBeNull();
    expect(duaEditBody({ ...dua, message: ' ' })).toBeNull();
  });
});
