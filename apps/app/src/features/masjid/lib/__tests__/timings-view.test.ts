import { type MasjidSchedule, nextJamaat, resolveSchedule } from '@mc/domain/prayer';
import type { SpecialDate } from '@mc/shared/contracts/public';
import { describe, expect, it } from 'vitest';

import { clampToRange, nextRowKey, timingRows, upcomingSpecials } from '../timings-view.ts';

// A6 acceptance: the times shown are exactly `@mc/domain`'s output for the masjid's configuration.

const SCHEDULE: MasjidSchedule = {
  coordinates: { lat: 17.385, lng: 78.4867 },
  method: 'karachi',
  madhab: 'hanafi',
  prayers: {
    fajr: { adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'offset', jamaatOffsetMin: 20 },
    dhuhr: { adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'fixed', jamaatTime: '13:30' },
    asr: { adhanMode: 'auto', adhanAdjustMin: 2, jamaatMode: 'offset', jamaatOffsetMin: 15 },
    maghrib: { adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'offset', jamaatOffsetMin: 5 },
    isha: { adhanMode: 'manual', adhanTime: '20:15', jamaatMode: 'fixed', jamaatTime: '20:30' },
  },
  jumuah: [
    { seq: 2, jamaatTime: '14:30' },
    { seq: 1, khutbahTime: '13:15', jamaatTime: '13:30' },
  ],
};

describe('timingRows', () => {
  it('mirrors the domain output, with Sunrise muted after Fajr', () => {
    const day = resolveSchedule(SCHEDULE, '2026-10-22'); // Thursday
    const rows = timingRows(day);
    expect(rows.map((row) => row.key)).toEqual(['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha']);
    for (const prayer of day.prayers) {
      const row = rows.find((entry) => entry.key === prayer.prayer);
      expect(row).toMatchObject({
        adhan: prayer.adhan,
        adhanCalculated: prayer.adhanCalculated,
        jamaat: prayer.jamaat,
      });
    }
    expect(rows[1]).toEqual({ key: 'sunrise', adhan: day.sunrise, adhanCalculated: true, jamaat: null, muted: true });
    expect(rows.find((row) => row.key === 'isha')).toMatchObject({ adhan: '20:15', adhanCalculated: false });
  });

  it("Friday: Dhuhr's row is Jumu'ah with the first jamaat", () => {
    const rows = timingRows(resolveSchedule(SCHEDULE, '2026-10-23'));
    expect(rows[2]).toMatchObject({ key: 'jumuah', jamaat: '13:30' });
  });
});

describe('nextRowKey', () => {
  it('tints the next jamaat only on its own day', () => {
    const today = resolveSchedule(SCHEDULE, '2026-10-22');
    const tomorrow = resolveSchedule(SCHEDULE, '2026-10-23');
    const next = nextJamaat(today, tomorrow, new Date('2026-10-22T12:00:00+05:30'));
    expect(nextRowKey(next, '2026-10-22')).toBe('dhuhr');
    expect(nextRowKey(next, '2026-10-23')).toBeNull();
    expect(nextRowKey(null, '2026-10-22')).toBeNull();
  });
});

describe('date range and specials', () => {
  it('clamps to today −7 … +60', () => {
    expect(clampToRange('2026-10-01', '2026-10-22')).toBe('2026-10-15');
    expect(clampToRange('2027-01-01', '2026-10-22')).toBe('2026-12-21');
    expect(clampToRange('2026-10-25', '2026-10-22')).toBe('2026-10-25');
  });

  it('groups upcoming specials by date, skipping past ones', () => {
    const special = (id: string, date: string): SpecialDate => ({
      id: `00000000-0000-4000-8000-00000000000${id}`,
      type: 'other',
      date,
      times: [{ time: '21:00' }],
    });
    expect(
      upcomingSpecials(
        [
          special('1', '2026-10-25'),
          special('2', '2026-10-20'),
          special('3', '2026-10-25'),
          special('4', '2026-10-22'),
        ],
        '2026-10-22',
      ),
    ).toEqual([
      { date: '2026-10-22', items: [special('4', '2026-10-22')] },
      { date: '2026-10-25', items: [special('1', '2026-10-25'), special('3', '2026-10-25')] },
    ]);
  });
});
