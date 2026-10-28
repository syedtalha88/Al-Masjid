import {
  ASR_MADHAB,
  CALC_METHOD,
  DHIKR_OCCASION,
  DUA_CATEGORY,
  INDIA,
  LIBRARY_KIND,
  LIBRARY_STATUS,
  MASJID_STATUS,
} from '@mc/db/schema';
import {
  ASR_MADHABS,
  CALC_METHODS,
  DHIKR_OCCASIONS,
  DUA_CATEGORIES,
  INDIA_BOUNDS,
  LIBRARY_KINDS,
  LIBRARY_STATUSES,
  MASJID_STATUSES,
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
  });
});
