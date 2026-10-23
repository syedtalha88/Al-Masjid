import { describe, expect, it } from 'vitest';

import { masjidName, masjidPlace } from '../masjid.ts';
import { mediaUrl } from '../media.ts';

describe('mediaUrl (DECISIONS #40)', () => {
  it('builds an allowed size/format URL and encodes every key segment', () => {
    expect(mediaUrl('masjids/abc/photo', 960, 'https://media.example.test')).toBe(
      'https://media.example.test/i/960/webp/masjids/abc/photo',
    );
    expect(mediaUrl('a b/../c?d', 480, 'https://media.example.test/')).toBe(
      'https://media.example.test/i/480/webp/a%20b/%2E%2E/c%3Fd',
    );
  });

  it('is null without a media origin', () => {
    expect(mediaUrl('k', 480, null)).toBeNull();
  });
});

describe('masjid display helpers', () => {
  const masjid = { name: 'Test Masjid Alpha', nameI18n: { hi: 'टेस्ट मस्जिद', ur: ' ' }, area: 'Area', city: 'City' };

  it('uses the name in the app language when one was entered', () => {
    expect(masjidName(masjid, 'en')).toBe('Test Masjid Alpha');
    expect(masjidName(masjid, 'hi')).toBe('टेस्ट मस्जिद');
    expect(masjidName(masjid, 'ur')).toBe('Test Masjid Alpha'); // blank → English
    expect(masjidName(masjid, 'te')).toBe('Test Masjid Alpha');
  });

  it('joins area and city, skipping blanks', () => {
    expect(masjidPlace(masjid)).toBe('Area, City');
    expect(masjidPlace({ area: '', city: 'City' })).toBe('City');
  });
});
