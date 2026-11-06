import {
  ADHKAR_MAX as DB_ADHKAR_MAX,
  ANNOUNCEMENT_CATEGORY,
  ASR_MADHAB,
  CALC_METHOD,
  CONTACTS_MAX as DB_CONTACTS_MAX,
  DHIKR_OCCASION,
  DUA_CATEGORY,
  E164_PATTERN,
  INDIA,
  LIBRARY_KIND,
  LIBRARY_STATUS,
  MASJID_STATUS,
  RUQYAH_CATEGORY,
  RUQYAH_MAX as DB_RUQYAH_MAX,
  SPECIAL_TYPE,
  TEMPLATE_PARAM_TYPE,
  TEMPLATE_STATUS,
} from '@mc/db/schema';
import { isE164 } from '@mc/domain/phone';
import {
  ADHKAR_MAX,
  ASR_MADHABS,
  CALC_METHODS,
  CONTACTS_MAX,
  DHIKR_OCCASIONS,
  DUA_CATEGORIES,
  E164,
  ilmContactSchema,
  INDIA_BOUNDS,
  LIBRARY_KINDS,
  LIBRARY_STATUSES,
  MASJID_STATUSES,
  RUQYAH_CATEGORIES,
  RUQYAH_CATEGORY_VALUES,
  RUQYAH_MAX,
  SPECIAL_TYPES,
  TEMPLATE_CATEGORIES,
  TEMPLATE_PARAM_TYPES,
  TEMPLATE_STATUSES,
} from '@mc/shared/contracts';
import { describe, expect, it } from 'vitest';

// The shared wire contracts carry their own copies of these (shared must not depend on @mc/db): keep them equal.
describe('shared contracts mirror the database schema', () => {
  it('enums and the India bounds are identical', () => {
    expect(MASJID_STATUSES).toEqual(MASJID_STATUS);
    expect(CALC_METHODS).toEqual(CALC_METHOD);
    expect(ASR_MADHABS).toEqual(ASR_MADHAB);
    expect(INDIA_BOUNDS).toEqual(INDIA);
  });

  it('Content Library enums are identical (T3.4)', () => {
    expect(LIBRARY_KINDS).toEqual(LIBRARY_KIND);
    expect(LIBRARY_STATUSES).toEqual(LIBRARY_STATUS);
    expect(DUA_CATEGORIES).toEqual(DUA_CATEGORY);
    expect(DHIKR_OCCASIONS).toEqual(DHIKR_OCCASION);
    expect(ADHKAR_MAX).toBe(DB_ADHKAR_MAX); // T3.14
  });

  it('notice template enums are identical (T3.5)', () => {
    expect(TEMPLATE_CATEGORIES).toEqual(ANNOUNCEMENT_CATEGORY);
    expect(TEMPLATE_STATUSES).toEqual(TEMPLATE_STATUS);
    expect(TEMPLATE_PARAM_TYPES).toEqual(TEMPLATE_PARAM_TYPE);
  });

  it('Ruqyah headings and the entry limit are identical (T3.15)', () => {
    expect(RUQYAH_CATEGORIES).toEqual(RUQYAH_CATEGORY);
    expect(RUQYAH_CATEGORY_VALUES).toEqual(RUQYAH_CATEGORY);
    expect(RUQYAH_MAX).toBe(DB_RUQYAH_MAX);
  });

  it('Ilm contact numbers follow one E.164 rule and the limit is identical (T3.16)', () => {
    expect(E164.source).toBe(new RegExp(E164_PATTERN).source);
    expect(CONTACTS_MAX).toBe(DB_CONTACTS_MAX);
    const contact = { id: '00000000-0000-4000-8000-000000000000', name: 'Test', audience: 'brothers' };
    for (const value of [
      '+910000000000',
      '+1234567',
      '+123456789012345',
      '+12345678901234567',
      '+0123456789',
      '9876500000',
      '+91 00000 00000',
    ]) {
      const db = new RegExp(E164_PATTERN).test(value);
      expect(E164.test(value)).toBe(db);
      expect(isE164(value)).toBe(db);
      expect(ilmContactSchema.safeParse({ ...contact, whatsapp: value }).success).toBe(db);
    }
  });

  it('special date types are identical (T3.3)', () => {
    expect(SPECIAL_TYPES).toEqual(SPECIAL_TYPE);
  });
});
