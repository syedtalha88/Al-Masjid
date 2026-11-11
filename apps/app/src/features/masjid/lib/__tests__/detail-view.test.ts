import type { ActiveMasjidBundle, FeedItem, ItemType } from '@mc/shared/contracts/public';
import { describe, expect, it } from 'vitest';

import { contactsFor, directionsLink, followLink, SECTION_TYPES, sectionRows, whatsappLink } from '../detail-view.ts';

const item = (publishedAt: string, type: ItemType = 'announcement'): FeedItem => ({
  publicId: `p${publishedAt.replace(/\D/g, '').slice(0, 10)}`,
  masjidId: '00000000-0000-4000-8000-000000000001',
  type,
  audience: 'everyone',
  isImportant: false,
  publishedAt,
});

const bundle = (showChanda: boolean, weeks: number): ActiveMasjidBundle => ({
  status: 'active',
  v: 1,
  masjid: {
    id: '00000000-0000-4000-8000-000000000001',
    followCode: 'TESTA001',
    name: 'Test Masjid Alpha',
    nameI18n: {},
    area: 'Area',
    city: 'City',
    state: 'State',
    verified: true,
    address: 'Address',
    lat: 17.385,
    lng: 78.4867,
    calcMethod: 'karachi',
    asrMadhab: 'hanafi',
    showChanda,
    chandaWeekStart: 5,
  },
  timings: null,
  specialDates: [],
  ramadan: null,
  adhkar: null,
  payment: null,
  campaigns: [],
  chanda: {
    weeks: Array.from({ length: weeks }, (_, index) => ({
      weekStart: `2026-10-0${String(index + 1)}`,
      amountPaise: 100,
    })),
  },
});

describe('sectionRows', () => {
  it('shows only sections with content, in order, with unseen counts since the later of visit and follow', () => {
    const pages = new Map<ItemType, FeedItem[]>([
      ['announcement', [item('2026-10-22T10:00:00.000Z'), item('2026-10-20T10:00:00.000Z')]],
      ['daily_content', []],
      ['video', [item('2026-10-21T10:00:00.000Z', 'video')]],
    ]);
    expect(
      sectionRows(bundle(true, 2), pages, '2026-10-21T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 'brothers'),
    ).toEqual([
      { id: 'announcements', unseen: 1 },
      { id: 'chanda', unseen: 0 },
      { id: 'bayans', unseen: 1 },
    ]);
    // Not followed: nothing is "new"; chanda hidden when the masjid does not show it.
    expect(sectionRows(bundle(false, 2), pages, undefined, null, 'brothers')).toEqual([
      { id: 'announcements', unseen: 0 },
      { id: 'bayans', unseen: 0 },
    ]);
    expect(sectionRows(bundle(true, 0), new Map(), undefined, null, 'brothers')).toEqual([]);
  });

  it('Weekly Chanda counts its new week entries; hidden chanda shows no row even with items (T5.6)', () => {
    const pages = new Map<ItemType, FeedItem[]>([
      [
        'chanda_update',
        [item('2026-10-23T10:00:00.000Z', 'chanda_update'), item('2026-10-16T10:00:00.000Z', 'chanda_update')],
      ],
    ]);
    const seen = '2026-10-21T00:00:00.000Z';
    const followed = '2026-10-01T00:00:00.000Z';
    expect(sectionRows(bundle(true, 2), pages, seen, followed, 'brothers')).toEqual([{ id: 'chanda', unseen: 1 }]);
    expect(sectionRows(bundle(true, 2), pages, undefined, null, 'brothers')).toEqual([{ id: 'chanda', unseen: 0 }]);
    expect(sectionRows(bundle(false, 2), pages, seen, followed, 'brothers')).toEqual([]);
    // The row does not wait for the feed page.
    expect(sectionRows(bundle(true, 2), new Map(), seen, followed, 'brothers')).toEqual([{ id: 'chanda', unseen: 0 }]);
  });

  it('"Adhkar after salah" after Dua Requests when the masjid has a set (T3.14)', () => {
    const entry = {
      id: '0b7f6c2e-1d4a-4f3b-9c8e-2a1b3c4d5e6f',
      kind: 'dhikr' as const,
      arabic: 'نَصٌّ تجريبي للعرض فقط',
      transliteration: {},
      translation: { en: 'Sample translation text for development.' },
      reference: 'DEV-SAMPLE-001',
      sourceName: 'Development fixture',
      sourceLicense: 'N/A — not for production',
    };
    const pages = new Map<ItemType, FeedItem[]>([['dua_request', [item('2026-10-22T10:00:00.000Z', 'dua_request')]]]);
    expect(
      sectionRows({ ...bundle(false, 0), adhkar: { entries: [entry] } }, pages, undefined, null, 'brothers'),
    ).toEqual([
      { id: 'duas', unseen: 0 },
      { id: 'adhkar', unseen: 0 },
    ]);
  });

  it('Ruqyah (A19) shows after adhkar when the bundle counts entries; a bundle cached before T3.15 shows none', () => {
    const pages = new Map<ItemType, FeedItem[]>();
    expect(
      sectionRows({ ...bundle(false, 0), sections: { ruqyah: 2, needy: 0 } }, pages, undefined, null, 'brothers'),
    ).toEqual([{ id: 'ruqyah', unseen: 0 }]);
    expect(
      sectionRows({ ...bundle(false, 0), sections: { ruqyah: 0, needy: 0 } }, pages, undefined, null, 'brothers'),
    ).toEqual([]);
    expect(sectionRows(bundle(false, 0), pages, undefined, null, 'brothers')).toEqual([]);
  });

  it('"Help the needy" (A23) shows between campaigns and chanda while the bundle counts listed people', () => {
    const pages = new Map<ItemType, FeedItem[]>();
    const listed = { ...bundle(true, 2), sections: { ruqyah: 0, needy: 3 } };
    expect(sectionRows(listed, pages, undefined, null, 'brothers')).toEqual([
      { id: 'needy', unseen: 0 },
      { id: 'chanda', unseen: 0 },
    ]);
    // Everyone fulfilled or closed: the row is gone.
    const none = { ...bundle(true, 2), sections: { ruqyah: 0, needy: 0 } };
    expect(sectionRows(none, pages, undefined, null, 'brothers').map((row) => row.id)).toEqual(['chanda']);
  });

  it('"Ask the masjid" (A21) shows only when there are contacts for the device’s own audience', () => {
    const pages = new Map<ItemType, FeedItem[]>();
    const contact = (audience: 'brothers' | 'sisters') => ({
      id: `00000000-0000-4000-8000-00000000000${audience === 'brothers' ? '1' : '2'}`,
      name: 'Test Contact',
      whatsapp: '+910000000001',
      audience,
    });
    const sistersOnly = { ...bundle(false, 0), contacts: [contact('sisters')] };
    expect(sectionRows(sistersOnly, pages, undefined, null, 'sisters')).toEqual([{ id: 'ilm', unseen: 0 }]);
    expect(sectionRows(sistersOnly, pages, undefined, null, 'brothers')).toEqual([]);
    expect(contactsFor({ ...sistersOnly, contacts: [contact('brothers'), contact('sisters')] }, 'brothers')).toEqual([
      contact('brothers'),
    ]);
    // A bundle cached before T3.16 has no contacts.
    expect(contactsFor(bundle(false, 0), 'sisters')).toEqual([]);
    // After Ruqyah, before chanda.
    const both = { ...bundle(true, 2), sections: { ruqyah: 1, needy: 0 }, contacts: [contact('brothers')] };
    expect(sectionRows(both, pages, undefined, null, 'brothers').map((row) => row.id)).toEqual([
      'ruqyah',
      'ilm',
      'chanda',
    ]);
  });

  it('loads the six feed types (chanda shows by the bundle; its items count what is new)', () => {
    expect(SECTION_TYPES).toEqual([
      'announcement',
      'daily_content',
      'dua_request',
      'campaign',
      'chanda_update',
      'video',
    ]);
  });
});

describe('links', () => {
  it('follow, WhatsApp and directions links', () => {
    expect(followLink('https://app.example', 'TESTA001')).toBe('https://app.example/m/TESTA001');
    expect(whatsappLink('Follow Alpha: https://x/m/A')).toBe(
      'https://wa.me/?text=Follow%20Alpha%3A%20https%3A%2F%2Fx%2Fm%2FA',
    );
    expect(directionsLink(17.385, 78.4867)).toBe('https://www.google.com/maps/dir/?api=1&destination=17.385,78.4867');
  });
});
