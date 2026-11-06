import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { dailyIndex } from '../src/rotation.ts';

// PHASE_03 T3.4 "Today's suggestion": a deterministic daily pick per masjid (07 B6) — the same masjid gets the same
// index all day, different days and different masjids spread over the candidates.
describe('dailyIndex', () => {
  it('is deterministic for a masjid and day, and within 0 … n-1', () => {
    expect(dailyIndex('masjid-a', '2026-10-28', 10)).toBe(dailyIndex('masjid-a', '2026-10-28', 10));
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.integer({ min: 1, max: 10_000 }), (seed, day, n) => {
        const index = dailyIndex(seed, day, n);
        expect(Number.isInteger(index) && index >= 0 && index < n).toBe(true);
      }),
    );
  });

  it('spreads days and masjids over the candidates', () => {
    const days = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
    expect(new Set(days.map((day) => dailyIndex('masjid-a', day, 50))).size).toBeGreaterThan(15);
    const masjids = Array.from({ length: 30 }, (_, i) => `masjid-${String(i)}`);
    expect(new Set(masjids.map((id) => dailyIndex(id, '2026-11-01', 50))).size).toBeGreaterThan(15);
  });

  it('refuses an empty candidate list', () => {
    expect(() => dailyIndex('masjid-a', '2026-10-28', 0)).toThrow(RangeError);
  });
});
