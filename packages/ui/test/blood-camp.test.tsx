// @vitest-environment jsdom
// T3.17 — a `blood_donation_camp` notice is a camp from its params: shown while upcoming or running, gone at the end of
// its hours (IST, also past midnight); the card shows date · hours and place, opens the notice, and "Contact on
// WhatsApp" opens wa.me with the greeting — the number is not printed on the card. Fake data only.
import type { FeedItem } from '@mc/shared/contracts/public';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BloodCampCard, bloodCampOf, templatePhones, upcomingCamps } from '../src/content/index.ts';
import { renderUi } from './render.tsx';

const camp = (
  publicId: string,
  params: NonNullable<FeedItem['templateParams']>,
  templateKey = 'blood_donation_camp',
): FeedItem => ({
  publicId,
  masjidId: '00000000-0000-4000-8000-000000000001',
  type: 'announcement',
  audience: 'everyone',
  publishedAt: '2026-11-01T06:00:00.000Z',
  templateKey,
  templateParams: params,
  isImportant: false,
  announcement: { category: 'event' },
});
const PARAMS = {
  date: '2026-11-08',
  hours: { start: '10:00', end: '16:00' },
  place: 'Test Hall',
  contact: '+919876500001',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('camp view', () => {
  it('reads a camp from its params, in IST', () => {
    const value = bloodCampOf(camp('seedCamp0001', PARAMS));
    expect(value?.start.toISOString()).toBe('2026-11-08T04:30:00.000Z');
    expect(value?.end.toISOString()).toBe('2026-11-08T10:30:00.000Z');
    expect(value).toMatchObject({ place: 'Test Hall', contact: '+919876500001' });
  });

  it('is no camp for another template or params that do not fit', () => {
    expect(bloodCampOf(camp('seedCamp0002', PARAMS, 'bayan_event'))).toBeNull();
    expect(bloodCampOf(camp('seedCamp0003', { ...PARAMS, contact: '9876500001' }))).toBeNull();
    expect(bloodCampOf(camp('seedCamp0004', { ...PARAMS, hours: '10:00' }))).toBeNull();
    expect(bloodCampOf(camp('seedCamp0005', { ...PARAMS, date: 'tomorrow' }))).toBeNull();
  });

  it('shows a camp until the end of its hours (also past midnight), soonest first, each once', () => {
    const day = camp('seedCamp0006', PARAMS);
    const night = camp('seedCamp0007', { ...PARAMS, date: '2026-11-07', hours: { start: '20:00', end: '01:00' } });
    const items = [day, night, day];
    const at = (iso: string) => upcomingCamps(items, new Date(iso)).map((value) => value.item.publicId);
    expect(at('2026-11-07T10:00:00.000Z')).toEqual(['seedCamp0007', 'seedCamp0006']);
    // 00:59 IST on the 8th: the night camp is still running.
    expect(at('2026-11-07T19:29:00.000Z')).toEqual(['seedCamp0007', 'seedCamp0006']);
    expect(at('2026-11-07T19:30:00.000Z')).toEqual(['seedCamp0006']);
    expect(at('2026-11-08T10:29:59.000Z')).toEqual(['seedCamp0006']);
    expect(at('2026-11-08T10:30:00.000Z')).toEqual([]);
  });
});

describe('BloodCampCard (07 A22)', () => {
  for (const locale of ['en', 'hi', 'ur', 'te'] as const) {
    it(`shows when and where, opens the notice, and WhatsApp with the greeting — no number printed (${locale})`, async () => {
      const value = bloodCampOf(camp('seedCamp0008', PARAMS));
      if (!value) throw new Error('no camp');
      const onOpen = vi.fn();
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      const { container } = await renderUi(<BloodCampCard camp={value} masjid="Test Masjid Alpha" onOpen={onOpen} />, {
        locale,
      });
      const card = container.querySelector('[data-blood-camp]');
      expect(card?.textContent).toContain('Test Hall');
      expect(card?.textContent).toContain('Test Masjid Alpha');
      expect(card?.textContent).not.toMatch(/98765|00001/);
      expect(card?.querySelector('h2')?.textContent.trim()).not.toBe('');
      const [summary, whatsapp] = screen.getAllByRole('button');
      if (!summary || !whatsapp) throw new Error('two buttons expected');
      fireEvent.click(summary);
      expect(onOpen).toHaveBeenCalledTimes(1);
      fireEvent.click(whatsapp);
      const url = new URL(String(open.mock.calls[0]?.[0]));
      expect(`${url.origin}${url.pathname}`).toBe('https://wa.me/919876500001');
      expect(url.searchParams.get('text')?.length).toBeGreaterThan(0);
    });
  }

  it('the admin preview opens nothing', async () => {
    const value = bloodCampOf(camp('seedCamp0009', PARAMS));
    if (!value) throw new Error('no camp');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await renderUi(<BloodCampCard camp={value} preview />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Contact on WhatsApp' }));
    expect(open).not.toHaveBeenCalled();
  });
});

describe('templatePhones (the notice detail’s WhatsApp buttons)', () => {
  const template = {
    key: 'blood_donation_camp',
    category: 'event' as const,
    icon: 'heartbeat',
    isImportantDefault: false,
    system: false,
    title: { en: 'Blood donation camp', hi: '', ur: '', te: '' },
    body: { en: '', hi: '', ur: '', te: '' },
    params: [
      { name: 'place', type: 'short_text' as const, required: true },
      { name: 'contact', type: 'phone' as const, required: true },
    ],
  };

  it('lists the E.164 values of the template’s phone params only', () => {
    expect(templatePhones(camp('seedCamp0010', PARAMS), template)).toEqual(['+919876500001']);
    expect(templatePhones(camp('seedCamp0011', { ...PARAMS, contact: '98765' }), template)).toEqual([]);
    expect(templatePhones(camp('seedCamp0012', PARAMS, 'bayan_event'), template)).toEqual([]);
    expect(templatePhones(camp('seedCamp0013', PARAMS), undefined)).toEqual([]);
  });
});
