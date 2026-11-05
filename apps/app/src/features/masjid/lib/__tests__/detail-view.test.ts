import type { ActiveMasjidBundle, FeedItem, ItemType } from '@mc/shared/contracts/public';
import { describe, expect, it } from 'vitest';

import { directionsLink, followLink, SECTION_TYPES, sectionRows, whatsappLink } from '../detail-view.ts';

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
    expect(sectionRows(bundle(true, 2), pages, '2026-10-21T00:00:00.000Z', '2026-10-01T00:00:00.000Z')).toEqual([
      { id: 'announcements', unseen: 1 },
      { id: 'chanda', unseen: 0 },
      { id: 'bayans', unseen: 1 },
    ]);
    // Not followed: nothing is "new"; chanda hidden when the masjid does not show it.
    expect(sectionRows(bundle(false, 2), pages, undefined, null)).toEqual([
      { id: 'announcements', unseen: 0 },
      { id: 'bayans', unseen: 0 },
    ]);
    expect(sectionRows(bundle(true, 0), new Map(), undefined, null)).toEqual([]);
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
    expect(sectionRows({ ...bundle(false, 0), adhkar: { entries: [entry] } }, pages, undefined, null)).toEqual([
      { id: 'duas', unseen: 0 },
      { id: 'adhkar', unseen: 0 },
    ]);
  });

  it('Ruqyah (A19) shows after adhkar when the bundle counts entries; a bundle cached before T3.15 shows none', () => {
    const pages = new Map<ItemType, FeedItem[]>();
    expect(sectionRows({ ...bundle(false, 0), sections: { ruqyah: 2, needy: 0 } }, pages, undefined, null)).toEqual([
      { id: 'ruqyah', unseen: 0 },
    ]);
    expect(sectionRows({ ...bundle(false, 0), sections: { ruqyah: 0, needy: 0 } }, pages, undefined, null)).toEqual([]);
    expect(sectionRows(bundle(false, 0), pages, undefined, null)).toEqual([]);
  });

  it('loads the five feed types (chanda is in the bundle)', () => {
    expect(SECTION_TYPES).toEqual(['announcement', 'daily_content', 'dua_request', 'campaign', 'video']);
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
