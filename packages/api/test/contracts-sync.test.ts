import {
  ADHKAR_MAX as DB_ADHKAR_MAX,
  ANNOUNCEMENT_CATEGORY,
  ASR_MADHAB,
  CALC_METHOD,
  DHIKR_OCCASION,
  DUA_CATEGORY,
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
import {
  ADHKAR_MAX,
  ASR_MADHABS,
  CALC_METHODS,
  DHIKR_OCCASIONS,
  DUA_CATEGORIES,
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

  it('special date types are identical (T3.3)', () => {
    expect(SPECIAL_TYPES).toEqual(SPECIAL_TYPE);
  });
});
