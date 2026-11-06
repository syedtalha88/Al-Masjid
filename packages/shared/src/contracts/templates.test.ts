import { describe, expect, it } from 'vitest';

import {
  adminMasjidStatsSchema,
  adminScheduleSchema,
  pushQuotaSchema,
  timingsPrayerInputSchema,
  timingsPreviewSchema,
  timingsSavedSchema,
  timingsSaveSchema,
} from './admin.ts';
import { TEMPLATE_ICONS } from './template-icons.ts';
import { superTemplateCreateSchema, superTemplatePatchSchema, TEMPLATE_MAX_PARAMS } from './templates.ts';

// PHASE_03 T3.5 / DECISIONS #111: the shape of a notice template (ICU itself is checked by the API).
const four = (text: string) => ({ en: text, hi: text, ur: text, te: text });
const TEMPLATE = {
  key: 'test_notice',
  category: 'event',
  icon: 'calendar',
  isImportantDefault: false,
  title: four('Test notice'),
  body: four('Test notice on {date}.'),
  params: [{ name: 'date', type: 'date', required: true }],
  translationReviewed: false,
};
const paths = (value: unknown) => {
  const result = superTemplateCreateSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('superTemplateCreateSchema', () => {
  it('accepts a complete template', () => {
    expect(paths(TEMPLATE)).toEqual([]);
  });

  it('keys: lower-case slugs of 3–64 characters', () => {
    expect(paths({ ...TEMPLATE, key: 'Test' })).toEqual(['key']);
    expect(paths({ ...TEMPLATE, key: 'ab' })).toEqual(['key']);
  });

  it('every language is required in title and body; unknown keys are refused', () => {
    expect(paths({ ...TEMPLATE, title: { en: 'Test' } })).toEqual(['title.hi', 'title.ur', 'title.te']);
    expect(paths({ ...TEMPLATE, body: { ...TEMPLATE.body, fr: 'x' } })).toEqual(['body']);
    expect(paths({ ...TEMPLATE, system: true })).toEqual(['']);
  });

  it(`params: unique names without "_", at most ${String(TEMPLATE_MAX_PARAMS)}, known types`, () => {
    expect(paths({ ...TEMPLATE, params: [{ name: 'my_date', type: 'date', required: true }] })).toEqual([
      'params.0.name',
    ]);
    expect(paths({ ...TEMPLATE, params: [TEMPLATE.params[0], TEMPLATE.params[0]] })).toEqual(['params']);
    const many = Array.from({ length: TEMPLATE_MAX_PARAMS + 1 }, (_, i) => ({
      name: `p${String(i)}`,
      type: 'number',
      required: false,
    }));
    expect(paths({ ...TEMPLATE, params: many })).toEqual(['params']);
    expect(paths({ ...TEMPLATE, params: [{ name: 'when', type: 'weekday', required: true }] })).toEqual([
      'params.0.type',
    ]);
  });

  it('icons come from the template icon set', () => {
    for (const icon of TEMPLATE_ICONS) expect(paths({ ...TEMPLATE, icon })).toEqual([]);
    expect(paths({ ...TEMPLATE, icon: 'rocket' })).toEqual(['icon']);
  });
});

describe('superTemplatePatchSchema', () => {
  it('needs at least one field; status is active or retired only; the key never changes', () => {
    expect(superTemplatePatchSchema.safeParse({}).success).toBe(false);
    expect(superTemplatePatchSchema.safeParse({ status: 'active' }).success).toBe(true);
    expect(superTemplatePatchSchema.safeParse({ status: 'draft' }).success).toBe(false);
    expect(superTemplatePatchSchema.safeParse({ key: 'other' }).success).toBe(false);
  });
});

describe('admin masjid contracts (T3.1)', () => {
  it('stats and quota are non-negative counts; schedules accept a masjid without timings', () => {
    expect(adminMasjidStatsSchema.safeParse({ followers: 3, itemsThisWeek: 0, ameenThisWeek: 1 }).success).toBe(true);
    expect(adminMasjidStatsSchema.safeParse({ followers: -1, itemsThisWeek: 0, ameenThisWeek: 0 }).success).toBe(false);
    expect(pushQuotaSchema.safeParse({ used: 2, limit: 8, resetsAt: '2026-11-01T18:30:00.000Z' }).success).toBe(true);
    const masjid = { name: 'Test Masjid Alpha', lat: 17.385, lng: 78.4867, calcMethod: 'karachi', asrMadhab: 'hanafi' };
    expect(adminScheduleSchema.safeParse({ masjid, timings: null, rev: 0 }).success).toBe(true);
    expect(adminScheduleSchema.safeParse({ masjid, timings: null }).success).toBe(false); // rev is required
    expect(
      adminScheduleSchema.safeParse({ masjid: { ...masjid, hijriOffset: 3 }, timings: null, rev: 0 }).success,
    ).toBe(false);
  });
});

describe('timings editor contracts (T3.2)', () => {
  const offset = { adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'offset', jamaatOffsetMin: 5 } as const;
  const body = {
    prayers: { fajr: offset, dhuhr: offset, asr: offset, maghrib: offset, isha: offset },
    jumuah: [{ seq: 1, jamaatTime: '13:30' }],
    notify: true,
  };

  it('each prayer carries exactly the fields of its modes', () => {
    expect(timingsPrayerInputSchema.safeParse(offset).success).toBe(true);
    for (const bad of [
      { ...offset, adhanTime: '05:00' }, // auto adhan with a time
      { adhanMode: 'manual', adhanAdjustMin: 0, jamaatMode: 'none' }, // manual without a time
      { adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'fixed' }, // fixed without a time
      { ...offset, jamaatTime: '05:30' }, // offset with a fixed time too
      { adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'none', jamaatOffsetMin: 5 },
      { ...offset, jamaatOffsetMin: 61 },
      { ...offset, adhanAdjustMin: 16 },
    ]) {
      expect(timingsPrayerInputSchema.safeParse(bad).success).toBe(false);
    }
    expect(
      timingsPrayerInputSchema.safeParse({
        adhanMode: 'manual',
        adhanTime: '19:45',
        adhanAdjustMin: 0,
        jamaatMode: 'fixed',
        jamaatTime: '20:00',
      }).success,
    ).toBe(true);
  });

  it("the body: five prayers, 1–3 Jumu'ah jamaats with distinct seq, the notify flag", () => {
    expect(timingsSaveSchema.safeParse(body).success).toBe(true);
    expect(timingsSaveSchema.safeParse({ ...body, jumuah: [] }).success).toBe(false);
    expect(
      timingsSaveSchema.safeParse({
        ...body,
        jumuah: [
          { seq: 1, jamaatTime: '13:30' },
          { seq: 1, jamaatTime: '14:00' },
        ],
      }).success,
    ).toBe(false);
    expect(timingsSaveSchema.safeParse({ ...body, notify: undefined }).success).toBe(false);
    expect(timingsSavedSchema.safeParse({ rev: 2, item: null }).success).toBe(true);
    expect(
      timingsPreviewSchema.safeParse({
        date: '2026-10-17',
        sunrise: '06:10',
        prayers: [{ prayer: 'fajr', adhan: '05:00', calculated: true, jamaat: null }],
        jumuah: [],
      }).success,
    ).toBe(true);
  });
});
