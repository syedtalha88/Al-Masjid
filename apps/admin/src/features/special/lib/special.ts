// B11 editor logic (07 B11, PHASE_03 T3.3): the drafts the screens edit, the bodies they send, and the live checks —
// the same `@mc/domain/special` rules the data layer enforces, so a blocked Save never reaches the server.
import { type CalcMethod, computeDay, type RamadanTimes, ramadanTimes } from '@mc/domain/prayer';
import {
  notifySpecialByDefault,
  type RamadanIssue,
  SPECIAL_TIMES_MAX,
  type SpecialDateIssue,
  validateRamadan,
  validateSpecialDate,
} from '@mc/domain/special';
import { compareCalendarDates } from '@mc/domain/time';
import type { AdminSpecialDate, Ramadan, RamadanSave, SpecialDateSave, SpecialType } from '@mc/shared/contracts';

export { SPECIAL_TIMES_MAX };
/** The precaution ranges (00 §4.2). */
export const SEHRI_RANGE = { min: 0, max: 15 } as const;
export const IFTAR_RANGE = { min: 0, max: 10 } as const;

export interface EntryDraft {
  readonly type: SpecialType | null;
  readonly date: string | null;
  readonly label: string;
  readonly times: readonly { readonly time: string; readonly label: string }[];
  readonly note: string;
}

export const EMPTY_ENTRY: EntryDraft = { type: null, date: null, label: '', times: [], note: '' };

/** A saved entry as a draft (absent labels become empty fields). */
export function entryDraftOf(entry: AdminSpecialDate): EntryDraft {
  return {
    type: entry.type,
    date: entry.date,
    label: entry.label ?? '',
    times: entry.times.map((slot) => ({ time: slot.time, label: slot.label ?? '' })),
    note: entry.note ?? '',
  };
}

/** Where the time wheel starts for a new time: the morning for Eid, after Isha for the night prayers. */
export function firstTimeFor(type: SpecialType | null): string {
  if (type === 'eid_ul_fitr' || type === 'eid_ul_adha') return '07:30';
  if (type === 'other' || type === null) return '10:00';
  return '21:00';
}

const optional = (text: string) => {
  const trimmed = text.trim();
  return trimmed === '' ? undefined : trimmed;
};

/**
 * The request body, or `null` while the draft is incomplete (no type, date or time). Empty labels and notes are left
 * out (the server removes them).
 */
export function entryBody(draft: EntryDraft, notify: boolean): SpecialDateSave | null {
  if (draft.type === null || draft.date === null || draft.times.length === 0) return null;
  const label = optional(draft.label);
  const note = optional(draft.note);
  return {
    type: draft.type,
    date: draft.date,
    ...(label === undefined ? {} : { label }),
    times: draft.times.map((slot) => {
      const slotLabel = optional(slot.label);
      return { time: slot.time, ...(slotLabel === undefined ? {} : { label: slotLabel }) };
    }),
    ...(note === undefined ? {} : { note }),
    notify,
  };
}

/** The live checks (empty while the date or times are missing — Save stays disabled for those anyway). */
export function entryIssues(draft: EntryDraft, today: string): SpecialDateIssue[] {
  if (draft.date === null || draft.times.length === 0) return [];
  return validateSpecialDate({ date: draft.date, times: draft.times }, today);
}

/** Has the admin changed anything since `saved` (or entered anything at all, for a new entry)? */
export function entryDirty(saved: EntryDraft, draft: EntryDraft): boolean {
  return JSON.stringify(saved) !== JSON.stringify(draft);
}

/** "Notify followers" starts on for an entry on today or tomorrow (00 §4.2). */
export const entryNotifyDefault = (draft: EntryDraft, today: string): boolean =>
  draft.date !== null && notifySpecialByDefault(draft.date, today);

/** The list in date order, split into today-and-later and the recent past (still editable). */
export function splitByToday(
  entries: readonly AdminSpecialDate[],
  today: string,
): { readonly upcoming: AdminSpecialDate[]; readonly past: AdminSpecialDate[] } {
  const sorted = [...entries].sort((a, b) => compareCalendarDates(a.date, b.date));
  return {
    upcoming: sorted.filter((entry) => compareCalendarDates(entry.date, today) >= 0),
    past: sorted.filter((entry) => compareCalendarDates(entry.date, today) < 0).reverse(),
  };
}

// --- Ramadan ---------------------------------------------------------------------------------------------------------

export interface RamadanDraft {
  readonly on: boolean;
  readonly start: string | null;
  readonly end: string | null;
  readonly sehri: number;
  readonly iftar: number;
}

export function ramadanDraftOf(saved: Ramadan): RamadanDraft {
  return {
    on: saved.start !== null && saved.end !== null,
    start: saved.start,
    end: saved.end,
    sehri: saved.sehriPrecaution,
    iftar: saved.iftarPrecaution,
  };
}

/** The request body, or `null` while Ramadan mode is on without both dates. Off sends no dates. */
export function ramadanBody(draft: RamadanDraft): RamadanSave | null {
  if (draft.on && (draft.start === null || draft.end === null)) return null;
  return {
    start: draft.on ? draft.start : null,
    end: draft.on ? draft.end : null,
    sehriPrecaution: draft.sehri,
    iftarPrecaution: draft.iftar,
  };
}

export function ramadanIssues(draft: RamadanDraft, today: string): RamadanIssue[] {
  if (!draft.on || draft.start === null || draft.end === null) return [];
  return validateRamadan({ start: draft.start, end: draft.end }, today);
}

/** Has anything changed since `saved`? Dates kept while off do not count. */
export function ramadanDirty(saved: RamadanDraft, draft: RamadanDraft): boolean {
  const body = (value: RamadanDraft) => JSON.stringify(ramadanBody(value));
  return body(saved) !== body(draft);
}

/**
 * Today's Sehri end and Iftar with these precautions, for the masjid's location — what the musalli Ramadan card
 * computes (`ramadanTimes` over the plain calculation).
 */
export function ramadanPreview(
  masjid: {
    readonly lat: number;
    readonly lng: number;
    readonly calcMethod: CalcMethod;
    readonly asrMadhab: 'hanafi' | 'shafi';
  },
  date: string,
  draft: RamadanDraft,
): RamadanTimes {
  const calculated = computeDay({ lat: masjid.lat, lng: masjid.lng }, date, masjid.calcMethod, masjid.asrMadhab);
  return ramadanTimes(calculated, draft.sehri, draft.iftar);
}
