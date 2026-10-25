import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { buildIcsEvent, escapeIcsText, foldIcsLine } from '../src/ics.ts';

const EVENT = {
  uid: 'AbCdEf123456@masjid-connect',
  start: new Date('2026-10-26T15:15:00Z'),
  title: 'Test lecture',
  now: new Date('2026-10-24T08:00:00.123Z'),
  prodId: '-//Masjid Connect//Item//EN',
} as const;

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

describe('escapeIcsText (RFC 5545 §3.3.11)', () => {
  it('escapes backslash, semicolon, comma and newlines', () => {
    expect(escapeIcsText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
  });

  it('drops other control characters', () => {
    expect(escapeIcsText('a\u0000b\u0007c\td')).toBe('abc d');
  });
});

describe('foldIcsLine (RFC 5545 §3.1)', () => {
  it('leaves short lines alone', () => {
    expect(foldIcsLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('folds at 75 octets with CRLF + space, never inside a UTF-8 character', () => {
    const line = `DESCRIPTION:${'ఆ'.repeat(60)}`;
    const folded = foldIcsLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const [index, part] of parts.entries()) {
      expect(utf8Length(part)).toBeLessThanOrEqual(75);
      if (index > 0) expect(part.startsWith(' ')).toBe(true);
    }
    expect(parts.map((part, index) => (index === 0 ? part : part.slice(1))).join('')).toBe(line);
  });

  it('round-trips any text (property)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 300 }), (text) => {
        const line = `X:${text}`;
        const parts = foldIcsLine(line).split('\r\n');
        expect(parts.every((part) => utf8Length(part) <= 75)).toBe(true);
        expect(parts.map((part, index) => (index === 0 ? part : part.slice(1))).join('')).toBe(line);
      }),
    );
  });
});

describe('buildIcsEvent', () => {
  it('writes one VEVENT with UTC times, CRLF line ends and a default one-hour length', () => {
    const ics = buildIcsEvent(EVENT);
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(ics.split('\r\n')).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Masjid Connect//Item//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:AbCdEf123456@masjid-connect',
      'DTSTAMP:20261024T080000Z',
      'DTSTART:20261026T151500Z',
      'DTEND:20261026T161500Z',
      'SUMMARY:Test lecture',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ]);
  });

  it('adds description, location and URL, escaped', () => {
    const ics = buildIcsEvent({
      ...EVENT,
      end: new Date('2026-10-26T17:00:00Z'),
      description: 'After Isha; all welcome, please\nbe on time',
      location: 'Test Masjid Alpha, Hyderabad',
      url: 'https://app.example.com/p/AbCdEf123456',
    });
    expect(ics).toContain('DTEND:20261026T170000Z\r\n');
    expect(ics).toContain('DESCRIPTION:After Isha\\; all welcome\\, please\\nbe on time\r\n');
    expect(ics).toContain('LOCATION:Test Masjid Alpha\\, Hyderabad\r\n');
    expect(ics).toContain('URL:https://app.example.com/p/AbCdEf123456\r\n');
  });

  it('cannot be broken out of by crafted text (no injected properties)', () => {
    const ics = buildIcsEvent({ ...EVENT, title: 'x\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:evil' });
    expect(ics.match(/^BEGIN:VEVENT$/gm)).toHaveLength(1);
    expect(ics).toContain('SUMMARY:x\\nEND:VEVENT\\nBEGIN:VEVENT\\nSUMMARY:evil');
  });

  it('refuses invalid dates, an end before the start, and a UID with unsafe characters', () => {
    expect(() => buildIcsEvent({ ...EVENT, start: new Date(Number.NaN) })).toThrow(RangeError);
    expect(() => buildIcsEvent({ ...EVENT, end: new Date('2026-10-26T15:00:00Z') })).toThrow(RangeError);
    expect(() => buildIcsEvent({ ...EVENT, uid: 'a\r\nb' })).toThrow(RangeError);
  });
});
