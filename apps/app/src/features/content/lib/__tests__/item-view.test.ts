import type { FeedItem, NoticeTemplate } from '@mc/shared/contracts/public';
import { describe, expect, it } from 'vitest';

import { itemKind, itemTitle } from '../item-view.ts';

const base = {
  publicId: 'abc',
  masjidId: '00000000-0000-4000-8000-000000000001',
  audience: 'everyone',
  isImportant: false,
  publishedAt: '2026-10-22T10:00:00.000Z',
} as const;
const item = (fields: Partial<FeedItem> & Pick<FeedItem, 'type'>): FeedItem => ({ ...base, ...fields });

describe('itemKind', () => {
  it.each([
    [item({ type: 'announcement' }), 'announcement'],
    [item({ type: 'announcement', announcement: { category: 'general' } }), 'announcement'],
    [item({ type: 'announcement', announcement: { category: 'facilities' } }), 'facilities'],
    [item({ type: 'timing_update' }), 'timing'],
    [item({ type: 'daily_content', daily: { kind: 'ayah' } }), 'ayah'],
    [item({ type: 'daily_content' }), 'hadith'],
    [item({ type: 'dua_request' }), 'dua'],
    [item({ type: 'campaign' }), 'campaign'],
    [item({ type: 'chanda_update' }), 'chanda'],
    [item({ type: 'video' }), 'video'],
  ] as const)('%#: → %s', (input, kind) => {
    expect(itemKind(input)).toBe(kind);
  });
});

describe('itemTitle', () => {
  const template: NoticeTemplate = {
    key: 'jumuah_timing',
    category: 'timing',
    icon: 'mosque',
    isImportantDefault: false,
    title: { en: 'Jumu’ah timing', hi: 'जुमा का समय', ur: '', te: 'జుమా సమయం' },
    body: { en: '', hi: '', ur: '', te: '' },
    params: [],
    system: true,
  };

  it('prefers the admin title, then the template title in the app language, then the body, then the label', () => {
    expect(itemTitle(item({ type: 'announcement', title: ' Water off ' }), 'hi', [template], 'Notice')).toBe(
      'Water off',
    );
    expect(itemTitle(item({ type: 'announcement', templateKey: 'jumuah_timing' }), 'hi', [template], 'Notice')).toBe(
      'जुमा का समय',
    );
    expect(itemTitle(item({ type: 'announcement', templateKey: 'jumuah_timing' }), 'ur', [template], 'Notice')).toBe(
      'Jumu’ah timing',
    );
    expect(itemTitle(item({ type: 'dua_request', body: '\n  Please make dua\nfor him' }), 'en', [], 'Dua')).toBe(
      'Please make dua',
    );
    expect(itemTitle(item({ type: 'announcement', templateKey: 'unknown' }), 'en', undefined, 'Notice')).toBe('Notice');
  });
});
