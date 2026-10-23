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
