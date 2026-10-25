import { describe, expect, it } from 'vitest';

import { eventFile, itemLink } from '../actions.ts';

describe('post actions', () => {
  it('links to the public landing without tracking parameters', () => {
    expect(itemLink('https://app.example.com/', 'AbCdEf123456')).toBe('https://app.example.com/p/AbCdEf123456');
  });

  it('builds the event calendar file with the masjid as location and the post link', () => {
    const file = eventFile({
      publicId: 'AbCdEf123456',
      start: new Date('2026-10-26T15:15:00Z'),
      title: 'Test lecture',
      body: 'After Isha, all welcome',
      masjid: 'Test Masjid Alpha',
      origin: 'https://app.example.com',
      now: new Date('2026-10-24T08:00:00Z'),
    });
    expect(file.filename).toBe('event-AbCdEf123456.ics');
    expect(file.text).toContain('UID:AbCdEf123456@app.example.com\r\n');
    expect(file.text).toContain('DTSTART:20261026T151500Z\r\n');
    expect(file.text).toContain('LOCATION:Test Masjid Alpha\r\n');
    expect(file.text).toContain('DESCRIPTION:After Isha\\, all welcome\r\n');
    expect(file.text).toContain('URL:https://app.example.com/p/AbCdEf123456\r\n');
    expect(file.text).toMatch(/^PRODID:-\/\/.+\/\/Notice\/\/EN\r$/m);
  });
});
