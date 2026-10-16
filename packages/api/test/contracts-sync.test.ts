import { ASR_MADHAB, CALC_METHOD, INDIA, MASJID_STATUS } from '@mc/db/schema';
import { ASR_MADHABS, CALC_METHODS, INDIA_BOUNDS, MASJID_STATUSES } from '@mc/shared/contracts';
import { describe, expect, it } from 'vitest';

// The shared wire contracts carry their own copies of these (shared must not depend on @mc/db): keep them equal.
describe('shared contracts mirror the database schema', () => {
  it('enums and the India bounds are identical', () => {
    expect(MASJID_STATUSES).toEqual(MASJID_STATUS);
    expect(CALC_METHODS).toEqual(CALC_METHOD);
    expect(ASR_MADHABS).toEqual(ASR_MADHAB);
    expect(INDIA_BOUNDS).toEqual(INDIA);
  });
});
