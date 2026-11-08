// PHASE_04 T4.4 — the words of a notification per locale: the masjid's name in the reader's script, the template title
// and ICU body with arguments formatted for that locale (same renderer as the apps), free text as written, the voice
// suffix, delivery hints, and the 3 KB payload budget. Texts are clearly fake placeholders (10 §Fixtures).
import type { PushContent } from '@mc/db/state';
import { pushPayloadSchema } from '@mc/shared/contracts/push';
import { describe, expect, it } from 'vitest';

import { cutText, pushMessage, pushOptions } from '../src/push/message.ts';

const BASE: PushContent = {
  publicId: 'seedA0000001',
  masjidId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  published: true,
  type: 'announcement',
  isImportant: false,
  category: 'general',
  title: undefined,
  body: undefined,
  templateKey: 'test_template',
  templateParams: { prayer: 'maghrib', time: '18:45' },
  hasVoice: false,
  contentVersion: 7,
  masjidName: 'Test Masjid Alpha',
  masjidNameI18n: { ur: 'ٹیسٹ مسجد الف', hi: 'टेस्ट मस्जिद अल्फ़ा' },
  template: {
    title: { en: 'Test timing notice', hi: 'टेस्ट समय सूचना', ur: 'ٹیسٹ وقت اطلاع', te: 'టెస్ట్ సమయ నోటీసు' },
    body: {
      en: 'Test body: {prayer} at {time}.',
      hi: 'टेस्ट: {prayer} {time} बजे।',
      ur: 'ٹیسٹ: {prayer} {time} بجے۔',
      te: 'టెస్ట్: {prayer} {time}కి.',
    },
    params: [
      { name: 'prayer', type: 'prayer' },
      { name: 'time', type: 'time' },
    ],
  },
};

describe('pushMessage', () => {
  it('English: masjid name, template title and the formatted body; opens the item', () => {
    const payload = pushMessage(BASE, 'en');
    expect(payload).toMatchObject({
      v: 1,
      t: 'Test Masjid Alpha',
      u: '/items/seedA0000001',
      m: BASE.masjidId,
      cv: 7,
      tag: 'seedA0000001',
      l: 'en',
    });
    expect(payload.b.split('\n')[0]).toBe('Test timing notice');
    expect(payload.b).toContain('Maghrib');
    expect(payload.b).toMatch(/6:45\s?pm/i);
  });

  it('Urdu: the masjid name in its script, the Urdu prayer name, the time LTR-isolated', () => {
    const payload = pushMessage(BASE, 'ur');
    expect(payload.t).toBe('ٹیسٹ مسجد الف');
    expect(payload.b.startsWith('ٹیسٹ وقت اطلاع\n')).toBe(true);
    expect(payload.b).toContain('مغرب');
    expect(payload.b).toContain('⁦'); // F58: times are isolates inside RTL sentences
    expect(payload.l).toBe('ur');
  });

  it('Telugu without a name in its script falls back to the masjid name', () => {
    expect(pushMessage(BASE, 'te').t).toBe('Test Masjid Alpha');
  });

  it("free text keeps the admin's words; a voice note adds the localized suffix", () => {
    const text: PushContent = {
      ...BASE,
      templateKey: undefined,
      template: undefined,
      templateParams: undefined,
      title: 'Test own title',
      body: 'Test own body line one.\nLine two.',
      hasVoice: true,
    };
    expect(pushMessage(text, 'en').b).toBe('Test own title · 🎤 Voice message\nTest own body line one.\nLine two.');
    expect(pushMessage(text, 'hi').b.startsWith('Test own title · 🎤 वॉइस मैसेज')).toBe(true);
  });

  it('daily content without a title uses the label the apps show', () => {
    const daily: PushContent = {
      ...BASE,
      type: 'daily_content',
      category: 'ayah',
      templateKey: undefined,
      template: undefined,
      templateParams: undefined,
    };
    expect(pushMessage(daily, 'en').b).toBe('Today’s Ayah');
  });

  it('a template whose params no longer fit still notifies with its title', () => {
    const broken: PushContent = { ...BASE, templateParams: { prayer: 'not-a-prayer' } };
    expect(pushMessage(broken, 'en').b).toBe('Test timing notice');
  });

  it('long texts are cut on grapheme boundaries and the payload stays within 3 KB', () => {
    const long: PushContent = {
      ...BASE,
      templateKey: undefined,
      template: undefined,
      title: 'T'.repeat(80),
      body: 'ٹیسٹ '.repeat(400),
      masjidName: 'M'.repeat(300),
      masjidNameI18n: {},
    };
    const payload = pushMessage(long, 'ur');
    expect(payload.t.length).toBeLessThanOrEqual(120);
    expect(payload.b.length).toBeLessThanOrEqual(400);
    expect(payload.b.endsWith('…')).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(3072);
    expect(pushPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('cutText never splits a grapheme', () => {
    expect(cutText('ab👍🏽cd', 4)).toBe('ab…');
    expect(cutText('short', 10)).toBe('short');
  });
});

describe('pushOptions', () => {
  it('important notices and inteqal requests are urgent; announcements live a day, others 12 h; topic = item', () => {
    expect(pushOptions(BASE)).toEqual({ ttlS: 86_400, urgency: 'normal', topic: 'seedA0000001' });
    expect(pushOptions({ ...BASE, isImportant: true }).urgency).toBe('high');
    expect(pushOptions({ ...BASE, type: 'dua_request', category: 'inteqal' })).toMatchObject({
      ttlS: 43_200,
      urgency: 'high',
    });
    expect(pushOptions({ ...BASE, type: 'dua_request', category: 'illness' }).urgency).toBe('normal');
  });
});
