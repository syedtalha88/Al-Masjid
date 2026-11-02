// The B4 timings editor's model (07 B4, 00 §4.2, PHASE_03 T3.2): the draft the admin edits, resolved with the same
// `@mc/domain/prayer` the musalli phones use — so the live checks, the "what changes" summary and the preview show
// exactly what followers will see.
import {
  type JumuahJamaat,
  type MasjidSchedule,
  type PrayerConfig,
  type PrayerName,
  PRAYERS,
  resolveSchedule,
} from '@mc/domain/prayer';
import { addDays } from '@mc/domain/time';
import { type TimingIssue, validateTimings } from '@mc/domain/timings';
import type { AdminSchedule, TimingsSave } from '@mc/shared/contracts';

export interface Draft {
  readonly prayers: Readonly<Record<PrayerName, PrayerConfig>>;
  readonly jumuah: readonly JumuahJamaat[];
}

/** Up to three Jumu'ah jamaats (00 §4.2). */
export const MAX_JUMUAH = 3;
/** Jamaat "minutes after adhan" range (00 §4.2) and the adhan adjustment range (02 masjid_timings). */
export const OFFSET_RANGE = { min: 0, max: 60 } as const;
export const ADJUST_RANGE = { min: -15, max: 15 } as const;

const auto = (jamaat: Pick<PrayerConfig, 'jamaatMode' | 'jamaatOffsetMin'>): PrayerConfig => ({
  adhanMode: 'auto',
  adhanAdjustMin: 0,
  ...jamaat,
});

/** 00 §4.2 defaults for a masjid without timings: calculated adhan, Maghrib jamaat 5 minutes after, the rest unset. */
export const NEW_MASJID_DRAFT: Draft = {
  prayers: {
    fajr: auto({ jamaatMode: 'none' }),
    dhuhr: auto({ jamaatMode: 'none' }),
    asr: auto({ jamaatMode: 'none' }),
    maghrib: auto({ jamaatMode: 'offset', jamaatOffsetMin: 5 }),
    isha: auto({ jamaatMode: 'none' }),
  },
  jumuah: [{ seq: 1, jamaatTime: '13:30' }],
};

/** The draft to start from: the saved timings, or the defaults. */
export function draftOf(schedule: AdminSchedule): Draft {
  return schedule.timings ?? NEW_MASJID_DRAFT;
}

/** The draft as the domain's schedule for this masjid. */
export function scheduleFor(masjid: AdminSchedule['masjid'], draft: Draft): MasjidSchedule {
  return {
    coordinates: { lat: masjid.lat, lng: masjid.lng },
    method: masjid.calcMethod,
    madhab: masjid.asrMadhab,
    prayers: draft.prayers,
    jumuah: draft.jumuah,
  };
}

/** The 00 §4.2 checks for the next 60 days from `today` (errors block saving, warnings do not). */
export function issuesOf(masjid: AdminSchedule['masjid'], draft: Draft, today: string): TimingIssue[] {
  return validateTimings(scheduleFor(masjid, draft), today);
}

/** Jamaat set for all five prayers — needed before the Super Admin can activate the masjid. */
export const allJamaatsSet = (draft: Draft): boolean =>
  PRAYERS.every((prayer) => draft.prayers[prayer].jamaatMode !== 'none');

/** One line of the confirm sheet's summary ("Isha jamaat 8:15 → 8:30"). `null` = not held / not set. */
export interface Change {
  readonly what: PrayerName | 'jumuah';
  readonly part: 'adhan' | 'jamaat' | 'khutbah';
  /** Jumu'ah jamaat number (1…3). */
  readonly seq?: number;
  readonly from: string | null;
  readonly to: string | null;
}

/**
 * What followers will see differently on `date`: each prayer's adhan and jamaat as resolved for that day, and every
 * Jumu'ah jamaat / khutbah. Before the first save everything that is set counts as new (`from: null`).
 */
export function changesOn(masjid: AdminSchedule['masjid'], before: Draft | null, after: Draft, date: string): Change[] {
  const next = resolveSchedule(scheduleFor(masjid, after), date);
  const previous = before ? resolveSchedule(scheduleFor(masjid, before), date) : null;
  const changes: Change[] = [];
  for (const [index, prayer] of next.prayers.entries()) {
    const old = previous?.prayers[index];
    if (old?.adhan !== prayer.adhan) {
      changes.push({ what: prayer.prayer, part: 'adhan', from: old?.adhan ?? null, to: prayer.adhan });
    }
    if ((old?.jamaat ?? null) !== prayer.jamaat) {
      changes.push({ what: prayer.prayer, part: 'jamaat', from: old?.jamaat ?? null, to: prayer.jamaat });
    }
  }
  const seqs = [...new Set([...(before?.jumuah ?? []), ...after.jumuah].map((slot) => slot.seq))].sort();
  for (const seq of seqs) {
    const old = before?.jumuah.find((slot) => slot.seq === seq);
    const now = after.jumuah.find((slot) => slot.seq === seq);
    if (old?.jamaatTime !== now?.jamaatTime) {
      changes.push({ what: 'jumuah', part: 'jamaat', seq, from: old?.jamaatTime ?? null, to: now?.jamaatTime ?? null });
    }
    if (old?.khutbahTime !== now?.khutbahTime) {
      changes.push({
        what: 'jumuah',
        part: 'khutbah',
        seq,
        from: old?.khutbahTime ?? null,
        to: now?.khutbahTime ?? null,
      });
    }
  }
  return changes;
}

/**
 * "Notify followers" starts on when today's or tomorrow's times change (00 §4.2) — Jumu'ah only counts when today or
 * tomorrow is a Friday.
 */
export function notifyByDefault(
  masjid: AdminSchedule['masjid'],
  before: Draft | null,
  after: Draft,
  today: string,
): boolean {
  return [today, addDays(today, 1)].some((date) => {
    const friday = resolveSchedule(scheduleFor(masjid, after), date).isFriday;
    return changesOn(masjid, before, after, date).some((change) => change.what !== 'jumuah' || friday);
  });
}

/** True when the draft differs from what is saved (or nothing is saved yet). */
export function isDirty(before: Draft | null, after: Draft): boolean {
  return before === null || JSON.stringify(normalized(before)) !== JSON.stringify(normalized(after));
}

const normalized = (draft: Draft) => ({
  prayers: PRAYERS.map((prayer) => {
    const p = draft.prayers[prayer];
    return [
      p.adhanMode,
      p.adhanTime ?? null,
      p.adhanAdjustMin ?? 0,
      p.jamaatMode,
      p.jamaatTime ?? null,
      p.jamaatOffsetMin ?? null,
    ];
  }),
  jumuah: [...draft.jumuah]
    .sort((a, b) => a.seq - b.seq)
    .map((slot) => [slot.seq, slot.khutbahTime ?? null, slot.jamaatTime]),
});

/** The `PUT /timings` body: only the fields each mode uses (the API refuses the others). */
export function saveBody(draft: Draft, notify: boolean): TimingsSave {
  const prayer = (p: PrayerConfig) => ({
    adhanMode: p.adhanMode,
    ...(p.adhanMode === 'manual' && p.adhanTime !== undefined ? { adhanTime: p.adhanTime } : {}),
    adhanAdjustMin: p.adhanMode === 'auto' ? (p.adhanAdjustMin ?? 0) : 0,
    jamaatMode: p.jamaatMode,
    ...(p.jamaatMode === 'fixed' && p.jamaatTime !== undefined ? { jamaatTime: p.jamaatTime } : {}),
    ...(p.jamaatMode === 'offset' && p.jamaatOffsetMin !== undefined ? { jamaatOffsetMin: p.jamaatOffsetMin } : {}),
  });
  return {
    prayers: {
      fajr: prayer(draft.prayers.fajr),
      dhuhr: prayer(draft.prayers.dhuhr),
      asr: prayer(draft.prayers.asr),
      maghrib: prayer(draft.prayers.maghrib),
      isha: prayer(draft.prayers.isha),
    },
    jumuah: [...draft.jumuah]
      .sort((a, b) => a.seq - b.seq)
      .map((slot, index) => ({
        seq: index + 1,
        ...(slot.khutbahTime === undefined ? {} : { khutbahTime: slot.khutbahTime }),
        jamaatTime: slot.jamaatTime,
      })),
    notify,
  };
}

/** Replaces one prayer's settings. */
export const withPrayer = (draft: Draft, prayer: PrayerName, config: PrayerConfig): Draft => ({
  ...draft,
  prayers: { ...draft.prayers, [prayer]: config },
});

/** Adds a Jumu'ah jamaat 30 minutes after the last one (at most {@link MAX_JUMUAH}). */
export function addJumuah(draft: Draft): Draft {
  if (draft.jumuah.length >= MAX_JUMUAH) return draft;
  const last = draft.jumuah.at(-1);
  const [hours = 13, minutes = 30] = (last?.jamaatTime ?? '13:00').split(':').map(Number);
  const total = Math.min(hours * 60 + minutes + 30, 23 * 60 + 59);
  const time = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  return { ...draft, jumuah: [...draft.jumuah, { seq: draft.jumuah.length + 1, jamaatTime: time }] };
}

/** Removes a Jumu'ah jamaat (never the last one) and renumbers the rest 1…n. */
export function removeJumuah(draft: Draft, seq: number): Draft {
  if (draft.jumuah.length <= 1) return draft;
  return {
    ...draft,
    jumuah: draft.jumuah.filter((slot) => slot.seq !== seq).map((slot, index) => ({ ...slot, seq: index + 1 })),
  };
}

/** Replaces one Jumu'ah jamaat. */
export const withJumuah = (draft: Draft, seq: number, slot: Omit<JumuahJamaat, 'seq'>): Draft => ({
  ...draft,
  jumuah: draft.jumuah.map((current) =>
    current.seq === seq
      ? {
          seq,
          jamaatTime: slot.jamaatTime,
          ...(slot.khutbahTime === undefined ? {} : { khutbahTime: slot.khutbahTime }),
        }
      : current,
  ),
});
