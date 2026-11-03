import { computeDay, ramadanTimes } from '@mc/domain/prayer';
import { describe, expect, it } from 'vitest';

import {
  EMPTY_ENTRY,
  entryBody,
  entryDirty,
  entryDraftOf,
  entryIssues,
  entryNotifyDefault,
  firstTimeFor,
  ramadanBody,
  ramadanDirty,
  ramadanDraftOf,
  ramadanIssues,
  ramadanPreview,
  splitByToday,
} from '../lib/special.ts';

// 07 B11 (PHASE_03 T3.3): drafts, request bodies and live checks of the special dates & Ramadan screen.

const TODAY = '2026-11-03';
const SAVED = {
  id: 'a',
  type: 'eid_ul_adha' as const,
  date: '2026-11-20',
  label: 'Test label',
  times: [{ time: '07:30', label: 'Test slot one' }, { time: '08:30' }],
};

describe('special date drafts', () => {
  it('round-trips a saved entry; empty labels and notes are left out of the body', () => {
    const draft = entryDraftOf(SAVED);
    expect(draft).toEqual({
      type: 'eid_ul_adha',
      date: '2026-11-20',
      label: 'Test label',
      times: [
        { time: '07:30', label: 'Test slot one' },
        { time: '08:30', label: '' },
      ],
      note: '',
    });
    expect(entryBody(draft, true)).toEqual({
      type: 'eid_ul_adha',
      date: '2026-11-20',
      label: 'Test label',
      times: [{ time: '07:30', label: 'Test slot one' }, { time: '08:30' }],
      notify: true,
    });
    expect(entryBody({ ...draft, label: '  ', note: ' Test note ' }, false)).toMatchObject({ note: 'Test note' });
    expect(entryBody({ ...draft, label: '  ' }, false)).not.toHaveProperty('label');
  });

  it('is incomplete without a type, a date or a time', () => {
    expect(entryBody(EMPTY_ENTRY, false)).toBeNull();
    expect(entryBody({ ...entryDraftOf(SAVED), times: [] }, false)).toBeNull();
    expect(entryBody({ ...entryDraftOf(SAVED), date: null }, false)).toBeNull();
    expect(entryBody({ ...entryDraftOf(SAVED), type: null }, false)).toBeNull();
  });

  it('checks live with the domain rules; nothing to check while incomplete', () => {
    expect(entryIssues(EMPTY_ENTRY, TODAY)).toEqual([]);
    expect(entryIssues(entryDraftOf(SAVED), TODAY)).toEqual([]);
    const twice = {
      ...entryDraftOf(SAVED),
      times: [
        { time: '07:30', label: '' },
        { time: '07:30', label: 'x' },
      ],
    };
    expect(entryIssues(twice, TODAY)).toEqual(['duplicate_time']);
    expect(entryIssues({ ...entryDraftOf(SAVED), date: '2028-01-01' }, TODAY)).toEqual(['date_out_of_range']);
  });

  it('dirty, notify default, first wheel time', () => {
    const draft = entryDraftOf(SAVED);
    expect(entryDirty(draft, draft)).toBe(false);
    expect(entryDirty(draft, { ...draft, note: 'x' })).toBe(true);
    expect(entryNotifyDefault({ ...draft, date: '2026-11-04' }, TODAY)).toBe(true);
    expect(entryNotifyDefault(draft, TODAY)).toBe(false);
    expect(entryNotifyDefault(EMPTY_ENTRY, TODAY)).toBe(false);
    expect(firstTimeFor('eid_ul_fitr')).toBe('07:30');
    expect(firstTimeFor('taraweeh')).toBe('21:00');
    expect(firstTimeFor('other')).toBe('10:00');
    expect(firstTimeFor(null)).toBe('10:00');
  });

  it('lists today and later in date order, then the recent past newest first', () => {
    const at = (id: string, date: string) => ({ ...SAVED, id, date });
    const { upcoming, past } = splitByToday(
      [at('c', '2026-11-30'), at('p1', '2026-10-20'), at('t', TODAY), at('p2', '2026-10-30')],
      TODAY,
    );
    expect(upcoming.map((entry) => entry.id)).toEqual(['t', 'c']);
    expect(past.map((entry) => entry.id)).toEqual(['p2', 'p1']);
  });
});

describe('Ramadan drafts', () => {
  const OFF = { start: null, end: null, sehriPrecaution: 5, iftarPrecaution: 2 };
  const ON = { start: '2027-02-08', end: '2027-03-09', sehriPrecaution: 5, iftarPrecaution: 2 };

  it('round-trips; off sends no dates; on without both dates is incomplete', () => {
    expect(ramadanBody(ramadanDraftOf(ON))).toEqual(ON);
    expect(ramadanBody(ramadanDraftOf(OFF))).toEqual(OFF);
    expect(ramadanBody({ ...ramadanDraftOf(ON), on: false })).toEqual({ ...ON, start: null, end: null });
    expect(ramadanBody({ ...ramadanDraftOf(OFF), on: true, start: '2027-02-08' })).toBeNull();
  });

  it('checks the dates only while on', () => {
    const backwards = { ...ramadanDraftOf(ON), start: '2027-03-09', end: '2027-02-08' };
    expect(ramadanIssues(backwards, TODAY)).toEqual(['end_before_start']);
    expect(ramadanIssues({ ...backwards, on: false }, TODAY)).toEqual([]);
    expect(ramadanIssues({ ...ramadanDraftOf(OFF), on: true }, TODAY)).toEqual([]);
  });

  it('dirty compares what would be sent (dates kept while off do not count)', () => {
    const saved = ramadanDraftOf(OFF);
    expect(ramadanDirty(saved, { ...saved, start: '2027-02-08' })).toBe(false);
    expect(ramadanDirty(saved, { ...saved, sehri: 6 })).toBe(true);
    expect(ramadanDirty(ramadanDraftOf(ON), { ...ramadanDraftOf(ON), on: false })).toBe(true);
  });

  it('the preview is the musalli calculation: calculated Fajr − Sehri precaution, sunset + Iftar precaution', () => {
    const masjid = { lat: 17.385, lng: 78.4867, calcMethod: 'karachi' as const, asrMadhab: 'hanafi' as const };
    const draft = ramadanDraftOf(ON);
    expect(ramadanPreview(masjid, TODAY, draft)).toEqual(
      ramadanTimes(computeDay({ lat: 17.385, lng: 78.4867 }, TODAY, 'karachi', 'hanafi'), 5, 2),
    );
  });
});
