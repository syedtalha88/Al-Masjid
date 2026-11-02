import { resolveSchedule } from '@mc/domain/prayer';
import { type AdminSchedule, timingsSaveSchema } from '@mc/shared/contracts';
import { describe, expect, it } from 'vitest';

import {
  addJumuah,
  allJamaatsSet,
  changesOn,
  draftOf,
  isDirty,
  issuesOf,
  MAX_JUMUAH,
  NEW_MASJID_DRAFT,
  notifyByDefault,
  removeJumuah,
  saveBody,
  scheduleFor,
  withJumuah,
  withPrayer,
} from '../lib/editor.ts';

// PHASE_03 T3.2 — the B4 editor model against the domain (a Hyderabad masjid; times are IST wall clock).
const MASJID = {
  name: 'Test Masjid Alpha',
  lat: 17.385,
  lng: 78.4867,
  calcMethod: 'karachi',
  asrMadhab: 'hanafi',
} as const;
const TODAY = '2026-10-22'; // a Thursday
const FRIDAY = '2026-10-23';

const fixed = (time: string) =>
  ({ adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'fixed', jamaatTime: time }) as const;
const SAVED: NonNullable<AdminSchedule['timings']> = {
  prayers: {
    fajr: fixed('05:30'),
    dhuhr: fixed('13:30'),
    asr: { adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'offset', jamaatOffsetMin: 15 },
    maghrib: { adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'offset', jamaatOffsetMin: 5 },
    isha: { adhanMode: 'manual', adhanTime: '19:45', adhanAdjustMin: 0, jamaatMode: 'fixed', jamaatTime: '20:15' },
  },
  jumuah: [{ seq: 1, khutbahTime: '13:00', jamaatTime: '13:30' }],
};

describe('draft', () => {
  it('starts from the saved timings, or the 00 §4.2 defaults (Maghrib +5, the rest unset)', () => {
    expect(draftOf({ masjid: MASJID, timings: SAVED, rev: 3 })).toBe(SAVED);
    const fresh = draftOf({ masjid: MASJID, timings: null, rev: 0 });
    expect(fresh).toBe(NEW_MASJID_DRAFT);
    expect(fresh.prayers.maghrib).toMatchObject({ jamaatMode: 'offset', jamaatOffsetMin: 5 });
    expect(allJamaatsSet(fresh)).toBe(false);
    expect(allJamaatsSet(SAVED)).toBe(true);
  });

  it('the schedule is resolved by the domain exactly like the musalli phones do', () => {
    const day = resolveSchedule(scheduleFor(MASJID, SAVED), TODAY);
    expect(day.prayers.find((p) => p.prayer === 'isha')).toMatchObject({ adhan: '19:45', jamaat: '20:15' });
  });

  it('live checks: Isha before Maghrib blocks, a late Fajr jamaat only warns', () => {
    expect(issuesOf(MASJID, SAVED, TODAY)).toEqual([]);
    const early = withPrayer(SAVED, 'isha', { ...SAVED.prayers.isha, adhanTime: '17:00', jamaatTime: '17:05' });
    expect(issuesOf(MASJID, early, TODAY)).toContainEqual(
      expect.objectContaining({ code: 'isha_before_maghrib', severity: 'error' }),
    );
    const late = withPrayer(SAVED, 'fajr', fixed('07:30'));
    expect(issuesOf(MASJID, late, TODAY)).toEqual([
      expect.objectContaining({ code: 'fajr_jamaat_after_sunrise', severity: 'warning', date: TODAY }),
    ]);
  });
});

describe('what changes', () => {
  it('lists the resolved times that differ on a day', () => {
    const later = withPrayer(SAVED, 'isha', { ...SAVED.prayers.isha, jamaatTime: '20:30' });
    expect(changesOn(MASJID, SAVED, later, TODAY)).toEqual([
      { what: 'isha', part: 'jamaat', from: '20:15', to: '20:30' },
    ]);
    expect(changesOn(MASJID, SAVED, SAVED, TODAY)).toEqual([]);
    // an offset change moves the resolved Maghrib jamaat
    const maghrib = withPrayer(SAVED, 'maghrib', { ...SAVED.prayers.maghrib, jamaatOffsetMin: 10 });
    const [change] = changesOn(MASJID, SAVED, maghrib, TODAY);
    expect(change).toMatchObject({ what: 'maghrib', part: 'jamaat' });
    expect(change?.to && change.from && change.to > change.from).toBe(true);
  });

  it("Jumu'ah jamaats and khutbahs, added and removed", () => {
    const two = withJumuah(addJumuah(SAVED), 1, { jamaatTime: '13:45' });
    expect(changesOn(MASJID, SAVED, two, TODAY)).toEqual([
      { what: 'jumuah', part: 'jamaat', seq: 1, from: '13:30', to: '13:45' },
      { what: 'jumuah', part: 'khutbah', seq: 1, from: '13:00', to: null },
      { what: 'jumuah', part: 'jamaat', seq: 2, from: null, to: '14:00' },
    ]);
  });

  it('before the first save everything set is new', () => {
    const changes = changesOn(MASJID, null, SAVED, TODAY);
    expect(changes.every((change) => change.from === null)).toBe(true);
    expect(changes.length).toBeGreaterThanOrEqual(10);
  });

  it("notify starts on for today's / tomorrow's times; Jumu'ah only around a Friday", () => {
    const later = withPrayer(SAVED, 'isha', { ...SAVED.prayers.isha, jamaatTime: '20:30' });
    expect(notifyByDefault(MASJID, SAVED, later, TODAY)).toBe(true);
    expect(notifyByDefault(MASJID, SAVED, SAVED, TODAY)).toBe(false);
    const jumuah = withJumuah(SAVED, 1, { khutbahTime: '13:00', jamaatTime: '13:45' });
    expect(notifyByDefault(MASJID, SAVED, jumuah, TODAY)).toBe(true); // tomorrow is Friday
    expect(notifyByDefault(MASJID, SAVED, jumuah, '2026-10-19')).toBe(false); // Monday and Tuesday
    expect(notifyByDefault(MASJID, SAVED, jumuah, FRIDAY)).toBe(true);
  });

  it('dirty only when something differs', () => {
    expect(isDirty(SAVED, { ...SAVED })).toBe(false);
    expect(isDirty(null, SAVED)).toBe(true);
    expect(isDirty(SAVED, withJumuah(SAVED, 1, { jamaatTime: '13:30' }))).toBe(true); // khutbah dropped
  });
});

describe("Jumu'ah list", () => {
  it('adds up to three, 30 minutes apart; removes renumber; never empty', () => {
    const three = addJumuah(addJumuah(SAVED));
    expect(three.jumuah.map((slot) => [slot.seq, slot.jamaatTime])).toEqual([
      [1, '13:30'],
      [2, '14:00'],
      [3, '14:30'],
    ]);
    expect(addJumuah(three).jumuah).toHaveLength(MAX_JUMUAH);
    expect(removeJumuah(three, 1).jumuah.map((slot) => [slot.seq, slot.jamaatTime])).toEqual([
      [1, '14:00'],
      [2, '14:30'],
    ]);
    expect(removeJumuah(SAVED, 1)).toBe(SAVED);
  });
});

describe('save body', () => {
  it('carries only the fields of each mode and passes the API contract', () => {
    const switched = withPrayer(SAVED, 'isha', {
      adhanMode: 'auto',
      adhanTime: '19:45', // left over from manual
      adhanAdjustMin: 2,
      jamaatMode: 'offset',
      jamaatTime: '20:15', // left over from fixed
      jamaatOffsetMin: 10,
    });
    const body = saveBody(switched, true);
    expect(body.prayers.isha).toEqual({
      adhanMode: 'auto',
      adhanAdjustMin: 2,
      jamaatMode: 'offset',
      jamaatOffsetMin: 10,
    });
    expect(timingsSaveSchema.safeParse(body).success).toBe(true);
    expect(body.notify).toBe(true);
    expect(timingsSaveSchema.safeParse(saveBody(NEW_MASJID_DRAFT, false)).success).toBe(true);
  });
});
