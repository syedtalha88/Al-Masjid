// Saving a masjid's prayer timings (00 §4.2, 03 §4 `PUT /timings`, PHASE_03 T3.2): the five prayers and Jumu'ah in one
// document, optimistic concurrency on `rev`, the version bump, the audit entry and — when the admin notifies — a
// `timing_update` item ("Prayer timings updated", system template) with its outbox job. One transaction.
import type { MasjidSchedule } from '@mc/domain/prayer';
import { calendarDateInZone } from '@mc/domain/time';
import { canSaveTimings, validateTimings } from '@mc/domain/timings';
import type { UUID } from 'mongodb';

import { type DbHandle, withTransaction } from '../client.ts';
import { contentWrite, StateError, writeAudit } from '../effects.ts';
import { requireOwnMasjid } from '../repos/admin.ts';
import { numberOf, oneOf } from '../repos/read.ts';
import { ASR_MADHAB, CALC_METHOD, PRAYER } from '../schema/enums.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText } from '../values.ts';
import { publishTimingUpdate } from './publish.ts';

export const PRAYER_KEYS = PRAYER;
export type PrayerKey = (typeof PRAYER_KEYS)[number];

/** One prayer's settings (02 masjid_timings; the API validated the mode rules). */
export interface PrayerTimingInput {
  readonly adhanMode: 'auto' | 'manual';
  readonly adhanTime?: string | undefined;
  readonly adhanAdjustMin: number;
  readonly jamaatMode: 'fixed' | 'offset' | 'none';
  readonly jamaatTime?: string | undefined;
  readonly jamaatOffsetMin?: number | undefined;
}

export interface TimingsInput {
  readonly prayers: Readonly<Record<PrayerKey, PrayerTimingInput>>;
  /** 1–3 jamaats, `seq` 1… ascending. */
  readonly jumuah: readonly {
    readonly seq: number;
    readonly khutbahTime?: string | undefined;
    readonly jamaatTime: string;
  }[];
}

/** The system template a timing update is shown with (`@mc/i18n/templates`). */
export const TIMINGS_UPDATED_TEMPLATE = 'timings_updated';

const prayerDoc = (p: PrayerTimingInput) => ({
  adhan_mode: p.adhanMode,
  ...(p.adhanMode === 'manual' && p.adhanTime !== undefined ? { adhan_time: p.adhanTime } : {}),
  adhan_adjust_min: p.adhanAdjustMin,
  jamaat_mode: p.jamaatMode,
  ...(p.jamaatMode === 'fixed' && p.jamaatTime !== undefined ? { jamaat_time: p.jamaatTime } : {}),
  ...(p.jamaatMode === 'offset' && p.jamaatOffsetMin !== undefined ? { jamaat_offset_min: p.jamaatOffsetMin } : {}),
});

const jumuahDoc = (slots: TimingsInput['jumuah']) =>
  [...slots]
    .sort((a, b) => a.seq - b.seq)
    .map((slot) => ({
      seq: slot.seq,
      ...(slot.khutbahTime === undefined ? {} : { khutbah_time: slot.khutbahTime }),
      jamaat_time: slot.jamaatTime,
    }));

/**
 * Saves the timings of one of the admin's masjids.
 *
 * @param input.expectedRev - the `rev` the admin edited (`If-Match`); 0 when the masjid had no timings yet.
 * @param input.notify - "Notify followers": publishes a `timing_update` item and its pending outbox job.
 * @returns the new `rev` and, when notifying, the item's public id.
 * @throws StateError MASJID_NOT_FOUND (outside the scope), PRECONDITION_FAILED (someone saved in between),
 *   TIMINGS_INVALID (a 00 §4.2 rule fails for the next 60 days — warnings never block), NOTIFY_QUOTA_EXCEEDED.
 */
export async function saveTimings(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly masjidId: UUID;
    readonly timings: TimingsInput;
    readonly expectedRev: number;
    readonly notify: boolean;
    readonly requestId?: string;
    readonly now?: Date;
  },
): Promise<{ rev: number; item: { publicId: string } | null; notificationJobId: string | null }> {
  requireOwnMasjid(scope, input.masjidId);
  if (scope.kind !== 'admin') throw new StateError('FORBIDDEN');
  const adminId = scope.adminId;
  const now = input.now ?? new Date();
  const prayers = Object.fromEntries(PRAYER_KEYS.map((key) => [key, prayerDoc(input.timings.prayers[key])]));
  const jumuah = jumuahDoc(input.timings.jumuah);

  return withTransaction(handle, scope, async (ctx) => {
    const masjid = await scoped(ctx, 'masjids').findOne({ _id: input.masjidId });
    if (!masjid) throw new StateError('MASJID_NOT_FOUND');
    // The rules are checked against the masjid's own location and method, as the musallis' phones resolve them.
    const schedule: MasjidSchedule = {
      coordinates: { lat: numberOf(masjid, 'lat') ?? 0, lng: numberOf(masjid, 'lng') ?? 0 },
      method: oneOf(masjid, 'calc_method', CALC_METHOD),
      madhab: oneOf(masjid, 'asr_madhab', ASR_MADHAB),
      prayers: input.timings.prayers,
      jumuah: input.timings.jumuah,
    };
    if (!canSaveTimings(validateTimings(schedule, calendarDateInZone(now)))) throw new StateError('TIMINGS_INVALID');

    const timings = scoped(ctx, 'masjid_timings');
    const current = await timings.findOne({ _id: input.masjidId });
    const currentRev = current ? (numberOf(current, 'rev') ?? 0) : 0;
    if (currentRev !== input.expectedRev) throw new StateError('PRECONDITION_FAILED');
    const rev = currentRev + 1;
    const version = (numberOf(masjid, 'content_version') ?? 0) + 1;
    const visible = masjid['status'] === 'active';

    const item = await contentWrite(ctx, input.masjidId, async (content) => {
      const store = scoped(content, 'masjid_timings');
      if (current === null) {
        await store.insertOne({
          _id: input.masjidId,
          prayers,
          jumuah,
          masjid_visible: visible,
          rev,
          updated_by: adminId,
          updated_at: now,
        });
      } else {
        // Matching the rev again makes the check and the write one step (a concurrent save fails here too).
        const matched = await store.updateOne(
          { _id: input.masjidId, rev: currentRev },
          { $set: { prayers, jumuah, rev, updated_by: adminId, updated_at: now } },
        );
        if (matched !== 1) throw new StateError('PRECONDITION_FAILED');
      }
      if (!input.notify) return null;
      return publishTimingUpdate(
        content,
        {
          templateKey: TIMINGS_UPDATED_TEMPLATE,
          templateParams: {},
          createdBy: adminId,
          masjidVisible: visible,
          version,
          limit: numberOf(masjid, 'push_daily_quota') ?? 0,
        },
        now,
      );
    });
    await writeAudit(ctx, {
      action: 'timings.update',
      masjidId: input.masjidId,
      targetType: 'masjid_timings',
      targetId: input.masjidId.toHexString(),
      meta: { rev, notify: input.notify },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return {
      rev,
      item: item ? { publicId: item.publicId } : null,
      notificationJobId: item ? idText(item.jobId) : null,
    };
  });
}
