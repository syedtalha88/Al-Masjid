import { duaMessages } from '@mc/i18n/dua-messages';
import { type AdminLibraryEntry, duaPublishSchema } from '@mc/shared/contracts';
import { describe, expect, it } from 'vitest';

import {
  detailIssues,
  draftForCategory,
  type DuaDraft,
  duaPreviewItem,
  duaPublishBody,
  janazaAtOf,
  withLocale,
  withMessageKey,
  withOwnMessage,
} from '../lib/dua.ts';

// 07 B7 (PHASE_03 T3.8): the draft, ready-made messages following the language, the checks, the publish body (it must
// pass the server's contract) and the preview item (a private name is not in it). Placeholder entries, fake names only.

const ENTRY: AdminLibraryEntry = {
  id: '0b7f6c2e-1d4a-4f3b-9c8e-2a1b3c4d5e6f',
  kind: 'dua',
  arabic: 'نَصٌّ تجريبي للعرض فقط',
  transliteration: { en: 'Sample transliteration — DEV ONLY' },
  translation: { en: 'Sample translation text for development. Not a real dua.' },
  reference: 'DEV-SAMPLE-008',
  sourceName: 'Development fixture',
  sourceLicense: 'N/A — not for production',
  tags: ['shifa'],
  duaCategory: 'illness',
};
const MASJID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const NOW = new Date('2026-11-04T06:30:00Z');
const ready = (over: Partial<DuaDraft> = {}): DuaDraft => ({
  ...draftForCategory('illness', 'en'),
  entry: ENTRY,
  ...over,
});

describe('dua drafts', () => {
  it('starts with the first ready-made message of the category, the name private, no dua', () => {
    const [first] = duaMessages('inteqal', 'hi');
    expect(draftForCategory('inteqal', 'hi')).toMatchObject({
      category: 'inteqal',
      locale: 'hi',
      messageKey: first?.key,
      message: first?.text,
      namePrivate: true,
      entry: null,
    });
  });

  it('a ready-made message follows the language; an own text stays as written', () => {
    const [, second] = duaMessages('illness', 'ur');
    const picked = withMessageKey(draftForCategory('illness', 'en'), second?.key ?? '');
    expect(withLocale(picked, 'ur').message).toBe(second?.text);
    const own = withOwnMessage(picked, 'Test own message');
    expect(withLocale(own, 'te')).toMatchObject({ locale: 'te', message: 'Test own message', messageKey: null });
    expect(withMessageKey(own, 'no_such_key')).toBe(own);
  });
});

describe('detailIssues', () => {
  it('names a missing or too long message, a too long name and a half-set janaza', () => {
    expect(detailIssues(ready({ message: '  ' }))).toEqual(['message']);
    expect(detailIssues(ready({ message: 'x'.repeat(501), personName: 'x'.repeat(81) }))).toEqual(['message', 'name']);
    const inteqal = ready({ category: 'inteqal', janazaDate: '2026-11-04', janazaTime: null });
    expect(detailIssues(inteqal)).toEqual(['janaza']);
    expect(detailIssues({ ...inteqal, janazaTime: '17:00' })).toEqual([]);
    expect(janazaAtOf({ ...inteqal, janazaTime: '17:00' })).toBe('2026-11-04T11:30:00.000Z'); // 5 PM IST
    expect(janazaAtOf({ ...inteqal, category: 'illness', janazaTime: '17:00' })).toBeUndefined();
  });
});

describe('duaPublishBody', () => {
  it('passes the server contract; trimmed; the janaza only for inteqal', () => {
    const body = duaPublishBody(ready({ personName: ' Testperson ', message: ' Test message ' }), true);
    expect(body).toMatchObject({ message: 'Test message', personName: 'Testperson', namePrivate: true, notify: true });
    expect(duaPublishSchema.safeParse(body).success).toBe(true);
    const inteqal = duaPublishBody(
      ready({ category: 'inteqal', janazaDate: '2026-11-04', janazaTime: '17:00', janazaPlace: ' Test place ' }),
      false,
    );
    expect(inteqal).toMatchObject({ janazaAt: '2026-11-04T11:30:00.000Z', janazaPlace: 'Test place' });
    expect(duaPublishSchema.safeParse(inteqal).success).toBe(true);
    expect(duaPublishBody(ready({ janazaPlace: 'Test place' }), false)).not.toHaveProperty('janazaPlace');
  });

  it('is null without a dua or with issues', () => {
    expect(duaPublishBody(ready({ entry: null }), false)).toBeNull();
    expect(duaPublishBody(ready({ message: '' }), false)).toBeNull();
  });
});

describe('duaPreviewItem', () => {
  it('a private name is not in the preview item — as the public view serves it', () => {
    const item = duaPreviewItem(ready({ personName: 'Testperson Private' }), MASJID, NOW);
    expect(item).toMatchObject({ type: 'dua_request', contentLocale: 'en', dua: { namePrivate: true } });
    expect(item.dua).not.toHaveProperty('personName');
    expect(item.dua?.library).toMatchObject({ reference: 'DEV-SAMPLE-008' });
    expect(item.dua?.library).not.toHaveProperty('tags');
    const shared = duaPreviewItem(ready({ personName: 'Testperson Shared', namePrivate: false }), MASJID, NOW);
    expect(shared.dua).toMatchObject({ personName: 'Testperson Shared', namePrivate: false });
  });
});
