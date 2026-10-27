import type { AdminSchedule } from '@mc/shared/contracts';
import { describe, expect, it } from 'vitest';

import { todayStrip } from '../lib/today.ts';

// 07 B3 today strip: the next jamaat resolved on the phone with @mc/domain/prayer (the musalli app's calculation).

const fixed = (time: string) => ({
  adhanMode: 'auto' as const,
  adhanAdjustMin: 0,
  jamaatMode: 'fixed' as const,
  jamaatTime: time,
});
const none = { adhanMode: 'auto' as const, adhanAdjustMin: 0, jamaatMode: 'none' as const };

const schedule = (timings: AdminSchedule['timings']): AdminSchedule => ({
  masjid: { name: 'Test Masjid Alpha', lat: 17.385, lng: 78.4867, calcMethod: 'karachi', asrMadhab: 'hanafi' },
  timings,
});

const ALL_FIXED = schedule({
  prayers: {
    fajr: fixed('05:30'),
    dhuhr: fixed('13:30'),
    asr: fixed('17:00'),
    maghrib: { adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'offset', jamaatOffsetMin: 5 },
    isha: fixed('20:30'),
  },
  jumuah: [{ seq: 1, jamaatTime: '13:30' }],
});

describe('todayStrip', () => {
  it('a Wednesday at noon: Dhuhr jamaat at 13:30 today', () => {
    expect(todayStrip(ALL_FIXED, new Date('2026-10-21T06:30:00Z'))).toEqual({
      kind: 'next',
      prayer: 'dhuhr',
      time: '13:30',
      tomorrow: false,
    });
  });

  it("after Isha: tomorrow's Fajr", () => {
    expect(todayStrip(ALL_FIXED, new Date('2026-10-21T16:30:00Z'))).toEqual({
      kind: 'next',
      prayer: 'fajr',
      time: '05:30',
      tomorrow: true,
    });
  });

  it("Friday noon: Jumu'ah instead of Dhuhr", () => {
    expect(todayStrip(ALL_FIXED, new Date('2026-10-23T06:30:00Z'))).toMatchObject({ kind: 'next', prayer: 'jumuah' });
  });

  it('no timings saved yet → unset; timings without any jamaat → none', () => {
    expect(todayStrip(schedule(null), new Date('2026-10-21T06:30:00Z'))).toEqual({ kind: 'unset' });
    const noJamaat = schedule({
      prayers: { fajr: none, dhuhr: none, asr: none, maghrib: none, isha: none },
      jumuah: [],
    });
    expect(todayStrip(noJamaat, new Date('2026-10-21T06:30:00Z'))).toEqual({ kind: 'none' });
  });
});
