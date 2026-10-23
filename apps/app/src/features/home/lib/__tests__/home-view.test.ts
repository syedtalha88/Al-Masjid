import type { ActiveMasjidBundle, FeedItem, SpecialDate } from '@mc/shared/contracts/public';
import { describe, expect, it } from 'vitest';

import { eidView, hasUnseen, mergeRecent, prayerView, ramadanView, scheduleOf } from '../home-view.ts';

// 07 A2 Home view model: strip day + highlighted cell, next jamaat across prayer boundaries (incl. Friday Jumu'ah and
// after Isha), Ramadan and Eid cards, recent updates. Fixed jamaat times keep the expectations independent of the
// astronomical calculation (tested in @mc/domain).

/** An IST wall-clock instant. */
const ist = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
const FRIDAY = '2026-10-23';
const THURSDAY = '2026-10-22';

const fixed = (time: string) =>
  ({ adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'fixed', jamaatTime: time }) as const;

function bundle(overrides: Partial<ActiveMasjidBundle> = {}, id = '00000000-0000-4000-8000-000000000001') {
  const base: ActiveMasjidBundle = {
    status: 'active',
    v: 1,
    masjid: {
      id,
      followCode: 'TESTA001',
      name: 'Test Masjid Alpha',
      nameI18n: {},
      area: 'Area',
      city: 'Hyderabad',
      state: 'Telangana',
      verified: true,
      address: 'Address',
      lat: 17.385,
      lng: 78.4867,
      calcMethod: 'karachi',
      asrMadhab: 'hanafi',
      showChanda: false,
      chandaWeekStart: 5,
    },
    timings: {
      prayers: {
        fajr: fixed('05:30'),
        dhuhr: fixed('13:30'),
        asr: fixed('16:45'),
        maghrib: fixed('18:30'),
        isha: fixed('20:30'),
      },
      jumuah: [
        { seq: 2, jamaatTime: '14:30' },
        { seq: 1, khutbahTime: '13:15', jamaatTime: '13:30' },
      ],
    },
    specialDates: [],
    ramadan: null,
    payment: null,
    campaigns: [],
    chanda: null,
  };
  return { ...base, ...overrides };
}

describe('prayerView', () => {
  it('is null until the admin sets timings', () => {
    expect(scheduleOf(bundle({ timings: null }))).toBeNull();
    expect(prayerView(bundle({ timings: null }), ist(THURSDAY, '12:00'))).toBeNull();
  });

  it('highlights the next jamaat and counts down to it (rounded up to the minute)', () => {
    const view = prayerView(bundle(), ist(THURSDAY, '11:41'));
    expect(view?.date).toBe(THURSDAY);
    expect(view?.slots.map((slot) => slot.time)).toEqual(['05:30', '13:30', '16:45', '18:30', '20:30']);
    expect(view?.activeIndex).toBe(1);
    expect(view?.next).toEqual({
      prayer: 'dhuhr',
      time: '13:30',
      at: ist(THURSDAY, '13:30'),
      countdown: { kind: 'left', hours: 1, minutes: 49 },
    });
  });

  it.each([
    ['13:21', { kind: 'soon', minutes: 9 }, 'dhuhr', 1],
    ['13:30', { kind: 'now' }, 'dhuhr', 1],
    ['13:39', { kind: 'now' }, 'dhuhr', 1],
    ['13:40', { kind: 'left', hours: 3, minutes: 5 }, 'asr', 2],
    ['20:41', { kind: 'left', hours: 8, minutes: 49 }, 'fajr', 0],
  ] as const)('Thursday %s → %j on %s', (time, expected, prayer, index) => {
    const view = prayerView(bundle(), ist(THURSDAY, time));
    expect(view?.next?.countdown).toEqual(expected);
    expect(view?.next?.prayer).toBe(prayer);
    expect(view?.activeIndex).toBe(index);
  });

  it('after the last jamaat the strip shows tomorrow (Fajr highlighted)', () => {
    const view = prayerView(bundle(), ist(THURSDAY, '21:00'));
    expect(view?.date).toBe(FRIDAY);
    expect(view?.activeIndex).toBe(0);
    // Tomorrow is Friday: its Dhuhr cell is the first Jumu'ah.
    expect(view?.slots[1]).toEqual({ prayer: 'jumuah', time: '13:30' });
  });

  it("Friday: the Dhuhr cell is Jumu'ah, and the countdown walks through both Jumu'ah jamaats", () => {
    expect(prayerView(bundle(), ist(FRIDAY, '12:00'))?.next).toMatchObject({ prayer: 'jumuah', time: '13:30' });
    const second = prayerView(bundle(), ist(FRIDAY, '13:45'));
    expect(second?.next).toMatchObject({
      prayer: 'jumuah',
      time: '14:30',
      countdown: { kind: 'left', hours: 0, minutes: 45 },
    });
    expect(second?.activeIndex).toBe(1);
  });

  it('a masjid without any jamaat has no next and no highlight', () => {
    const none = { adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'none' } as const;
    const view = prayerView(
      bundle({
        timings: { prayers: { fajr: none, dhuhr: none, asr: none, maghrib: none, isha: none }, jumuah: [] },
      }),
      ist(THURSDAY, '12:00'),
    );
    expect(view?.next).toBeNull();
    expect(view?.activeIndex).toBeNull();
    expect(view?.maghrib).toMatch(/^1[78]:\d\d$/);
  });
});

describe('ramadanView', () => {
  const ramadan = { start: '2026-10-20', end: THURSDAY, sehriPrecautionMin: 10, iftarPrecautionMin: 2 };

  it('uses the first masjid in Ramadan mode and counts down to the next of Sehri / Iftar', () => {
    const other = bundle({}, '00000000-0000-4000-8000-000000000002');
    const inRamadan = bundle({ ramadan }, '00000000-0000-4000-8000-000000000003');
    const midday = ramadanView([other, inRamadan], ist('2026-10-21', '12:00'));
    expect(midday?.masjidId).toBe('00000000-0000-4000-8000-000000000003');
    expect(midday?.next?.kind).toBe('iftar');
    expect(midday?.sehriEnds).toMatch(/^0[45]:\d\d$/);
    expect(midday?.iftar).toMatch(/^1[78]:\d\d$/);
    // After Iftar on a middle day: tomorrow's Sehri.
    expect(ramadanView([inRamadan], ist('2026-10-21', '22:00'))?.next?.kind).toBe('sehri');
  });

  it('on the last day, after Iftar nothing is left; outside the dates there is no card', () => {
    expect(ramadanView([bundle({ ramadan })], ist(THURSDAY, '22:00'))?.next).toBeNull();
    expect(ramadanView([bundle({ ramadan })], ist(FRIDAY, '12:00'))).toBeNull();
    expect(ramadanView([bundle({ ramadan, timings: null })], ist(THURSDAY, '12:00'))).toBeNull();
  });
});

describe('eidView', () => {
  const special = (date: string, type: SpecialDate['type'] = 'eid_ul_fitr'): SpecialDate => ({
    id: `00000000-0000-4000-8000-${date.replace(/-/g, '').padStart(12, '0')}`,
    type,
    date,
    times: [{ time: '07:00' }, { time: '08:30' }],
  });

  it('shows the nearest Eid within today + 3 days', () => {
    const a = bundle({ specialDates: [special('2026-10-25'), special('2026-10-24', 'taraweeh')] });
    const b = bundle({ specialDates: [special('2026-10-24', 'eid_ul_adha')] }, '00000000-0000-4000-8000-000000000002');
    const view = eidView([a, b], ist(THURSDAY, '09:00'));
    expect(view).toMatchObject({ masjidId: '00000000-0000-4000-8000-000000000002', inDays: 2 });
    expect(view?.special.type).toBe('eid_ul_adha');
    expect(eidView([a], ist(THURSDAY, '09:00'))?.inDays).toBe(3);
  });

  it('ignores past dates, dates beyond the window and Eids without times', () => {
    expect(eidView([bundle({ specialDates: [special('2026-10-21')] })], ist(THURSDAY, '09:00'))).toBeNull();
    expect(eidView([bundle({ specialDates: [special('2026-10-26')] })], ist(THURSDAY, '09:00'))).toBeNull();
    expect(
      eidView([bundle({ specialDates: [{ ...special(THURSDAY), times: [] }] })], ist(THURSDAY, '09:00')),
    ).toBeNull();
    expect(eidView([bundle({ specialDates: [special(THURSDAY)] })], ist(THURSDAY, '23:00'))?.inDays).toBe(0);
  });
});

describe('recent updates', () => {
  const item = (publicId: string, publishedAt: string): FeedItem => ({
    publicId,
    publishedAt,
    masjidId: '00000000-0000-4000-8000-000000000001',
    type: 'announcement',
    audience: 'everyone',
    isImportant: false,
  });

  it('merges feeds newest first and keeps 5', () => {
    const merged = mergeRecent(
      [
        [item('a1', '2026-10-22T10:00:00.000Z'), item('a2', '2026-10-20T10:00:00.000Z')],
        [item('b1', '2026-10-21T10:00:00.000Z'), item('b2', '2026-10-22T10:00:00.000Z')],
        [item('c1', '2026-10-19T10:00:00.000Z'), item('c2', '2026-10-18T10:00:00.000Z')],
      ],
      5,
    );
    expect(merged.map((entry) => entry.publicId)).toEqual(['a1', 'b2', 'b1', 'a2', 'c1']);
  });

  it('the bell dot: anything newer than the last Updates visit', () => {
    const items = [item('a', '2026-10-22T10:00:00.000Z')];
    expect(hasUnseen([], undefined)).toBe(false);
    expect(hasUnseen(items, undefined)).toBe(true);
    expect(hasUnseen(items, '2026-10-22T09:00:00.000Z')).toBe(true);
    expect(hasUnseen(items, '2026-10-22T10:00:00.000Z')).toBe(false);
  });
});
