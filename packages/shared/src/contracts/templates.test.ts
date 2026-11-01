import { describe, expect, it } from 'vitest';

import { adminMasjidStatsSchema, adminScheduleSchema, pushQuotaSchema } from './admin.ts';
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
    expect(adminScheduleSchema.safeParse({ masjid, timings: null }).success).toBe(true);
    expect(adminScheduleSchema.safeParse({ masjid: { ...masjid, hijriOffset: 3 }, timings: null }).success).toBe(false);
  });
});
