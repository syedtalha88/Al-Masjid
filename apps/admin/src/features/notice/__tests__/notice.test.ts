import type { TemplateValue } from '@mc/i18n/template-args';
import { announcementPublishSchema } from '@mc/shared/contracts';
import type { NoticeTemplate } from '@mc/shared/contracts/public';
import { describe, expect, it } from 'vitest';

import {
  draftForTemplate,
  draftForText,
  eventAtOf,
  type NoticeDraft,
  noticeIssues,
  phoneValue,
  previewItem,
  publishBody,
  templateOf,
} from '../lib/notice.ts';

// 07 B5 (PHASE_03 T3.6): notice drafts, the checks behind "Next: Preview", the publish body (it must pass the
// server's contract) and the item the preview renders. Fake texts only (10 §Fixtures).

const four = (text: string) => ({ en: text, hi: text, ur: text, te: text });
const NO_WATER: NoticeTemplate = {
  key: 'no_water_time_range',
  category: 'facilities',
  icon: 'drop',
  isImportantDefault: true,
  title: four('Test title'),
  body: four('Test body {hours_start}–{hours_end}'),
  params: [{ name: 'hours', type: 'time_range', required: true }],
  system: false,
};
const MASJID = '0b7f6c2e-1d4a-4f3b-9c8e-2a1b3c4d5e6f';
const NOW = new Date('2026-11-04T06:30:00Z');

const withValues = (values: Record<string, TemplateValue>): NoticeDraft => ({
  ...draftForTemplate(NO_WATER),
  content: { kind: 'template', key: NO_WATER.key, values },
});

describe('notice drafts', () => {
  it('a template draft takes the category and Important default of its template', () => {
    expect(draftForTemplate(NO_WATER)).toEqual({
      content: { kind: 'template', key: 'no_water_time_range', values: {} },
      category: 'facilities',
      isImportant: true,
      eventDate: null,
      eventTime: null,
      photo: null,
    });
    expect(templateOf(draftForTemplate(NO_WATER), [NO_WATER])).toBe(NO_WATER);
    expect(templateOf(draftForText('en'), [NO_WATER])).toBeUndefined();
  });

  it('"Write your own" starts in the admin language, General, not Important', () => {
    expect(draftForText('te')).toMatchObject({
      content: { kind: 'text', title: '', body: '', locale: 'te' },
      category: 'general',
      isImportant: false,
    });
  });
});

describe('noticeIssues', () => {
  it('names missing or malformed params with the server check', () => {
    expect(noticeIssues(draftForTemplate(NO_WATER), NO_WATER)).toEqual([{ kind: 'param', name: 'hours' }]);
    expect(noticeIssues(withValues({ hours: { start: '10:00', end: '' } }), NO_WATER)).toEqual([
      { kind: 'param', name: 'hours' },
    ]);
    expect(noticeIssues(withValues({ hours: { start: '22:00', end: '02:00' } }), NO_WATER)).toEqual([]);
  });

  it('a template that is gone (retired meanwhile) blocks the draft', () => {
    expect(noticeIssues(draftForTemplate(NO_WATER), undefined)).toEqual([{ kind: 'template' }]);
  });

  it('own text needs a title (≤ 80) and a message (≤ 1,000) after trimming', () => {
    const text = (title: string, body: string): NoticeDraft => ({
      ...draftForText('en'),
      content: { kind: 'text', title, body, locale: 'en' },
    });
    expect(noticeIssues(text('  ', ''), undefined)).toEqual([{ kind: 'title' }, { kind: 'body' }]);
    expect(noticeIssues(text('x'.repeat(81), 'x'.repeat(1001)), undefined)).toEqual([
      { kind: 'title' },
      { kind: 'body' },
    ]);
    expect(noticeIssues(text(' Test title ', 'Test body'), undefined)).toEqual([]);
  });

  it('an event needs both its date and time, or neither', () => {
    const event = (eventDate: string | null, eventTime: string | null): NoticeDraft => ({
      ...withValues({ hours: { start: '10:00', end: '14:00' } }),
      category: 'event',
      eventDate,
      eventTime,
    });
    expect(noticeIssues(event('2026-11-10', null), NO_WATER)).toEqual([{ kind: 'event' }]);
    expect(noticeIssues(event(null, '19:00'), NO_WATER)).toEqual([{ kind: 'event' }]);
    expect(noticeIssues(event(null, null), NO_WATER)).toEqual([]);
    expect(eventAtOf(event('2026-11-10', '19:00'))).toBe('2026-11-10T13:30:00.000Z'); // 7 PM IST
    expect(eventAtOf({ ...event('2026-11-10', '19:00'), category: 'general' })).toBeUndefined();
  });
});

describe('publishBody', () => {
  it('a template notice passes the server contract', () => {
    const body = publishBody(withValues({ hours: { start: '10:00', end: '14:00' } }), NO_WATER, true);
    expect(body).toEqual({
      content: { kind: 'template', key: 'no_water_time_range', params: { hours: { start: '10:00', end: '14:00' } } },
      category: 'facilities',
      isImportant: true,
      notify: true,
    });
    expect(announcementPublishSchema.safeParse(body).success).toBe(true);
  });

  it('own text with an event and a photo passes the contract; trimmed', () => {
    const draft: NoticeDraft = {
      content: { kind: 'text', title: ' Test title ', body: 'Test body\n', locale: 'ur' },
      category: 'event',
      isImportant: false,
      eventDate: '2026-11-10',
      eventTime: '19:00',
      photo: { key: `m/${MASJID}/0b7f6c2e-1d4a-4f3b-9c8e-2a1b3c4d5e6f`, thumbhash: 'AAAA', url: 'https://m.test/x' },
    };
    const body = publishBody(draft, undefined, false);
    expect(body).toMatchObject({
      content: { kind: 'text', title: 'Test title', body: 'Test body', locale: 'ur' },
      eventAt: '2026-11-10T13:30:00.000Z',
      image: { key: draft.photo?.key, thumbhash: 'AAAA', rightsConfirmed: true },
      notify: false,
    });
    expect(announcementPublishSchema.safeParse(body).success).toBe(true);
  });

  it('is null while the draft has issues', () => {
    expect(publishBody(draftForTemplate(NO_WATER), NO_WATER, true)).toBeNull();
  });
});

describe('previewItem', () => {
  it('is the item musallis receive: template params, Important, category, published now', () => {
    expect(previewItem(withValues({ hours: { start: '10:00', end: '14:00' } }), MASJID, NOW)).toMatchObject({
      masjidId: MASJID,
      type: 'announcement',
      audience: 'everyone',
      templateKey: 'no_water_time_range',
      templateParams: { hours: { start: '10:00', end: '14:00' } },
      isImportant: true,
      publishedAt: NOW.toISOString(),
      announcement: { category: 'facilities' },
    });
  });

  it('own text keeps its language', () => {
    const draft: NoticeDraft = {
      ...draftForText('te'),
      content: { kind: 'text', title: 'Test title', body: 'Test body', locale: 'te' },
    };
    expect(previewItem(draft, MASJID, NOW)).toMatchObject({
      title: 'Test title',
      body: 'Test body',
      contentLocale: 'te',
    });
  });
});

describe('phoneValue', () => {
  it('adds +91 to a 10-digit Indian mobile number and drops spaces and dashes', () => {
    expect(phoneValue('98765 43210')).toBe('+919876543210');
    expect(phoneValue('+91 98765-43210')).toBe('+919876543210');
    expect(phoneValue('12345')).toBe('12345');
  });
});
