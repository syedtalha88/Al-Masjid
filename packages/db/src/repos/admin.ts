// Typed read repositories for the masjid admin screens (PHASE_03; 03 §4 masjid-scoped). Every read goes through the
// policy gateway with the admin's scope, so only the admin's own masjids are reachable; a masjid outside the scope
// answers like an unknown one (`MASJID_NOT_FOUND`) — never another tenant's data, never "it exists but not for you".
import { addDays, calendarDateInZone, istInstant } from '@mc/domain/time';
import type { UUID } from 'mongodb';

import type { DbHandle } from '../client.ts';
import { StateError } from '../effects.ts';
import { ASR_MADHAB, CALC_METHOD, SPECIAL_TYPE } from '../schema/enums.ts';
import { type Scope, scopeMasjidIds } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText } from '../values.ts';
import { arrayOf, compact, idOf, need, numberOf, oneOf, text, timingsOf } from './read.ts';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** `push_quota_usage._id` (02): "<masjid id>:<IST day>" — shared with the publish path that increments it. */
export const quotaUsageId = (masjidId: UUID, day: string): string => `${idText(masjidId)}:${day}`;

/** @throws StateError `MASJID_NOT_FOUND` unless `masjidId` is one of the admin's masjids. */
export function requireOwnMasjid(scope: Scope, masjidId: UUID): void {
  if (scope.kind !== 'admin' || !scopeMasjidIds(scope).some((id) => id.equals(masjidId))) {
    throw new StateError('MASJID_NOT_FOUND');
  }
}

/**
 * Admin Home header numbers (07 B3, 03 §4 `GET /stats`).
 *
 * @param now - the instant "this week" ends (the last 7 × 24 h).
 * @returns followers (`masjid_stats`), Ameens on this masjid's dua requests in the last 7 days (`masjid_stats.ameens_7d`,
 *   up to an hour old — the `stats-snapshot` job), and items published in the last 7 days.
 * @throws StateError `MASJID_NOT_FOUND` for a masjid outside the admin's scope.
 */
export async function getMasjidStats(
  handle: DbHandle,
  scope: Scope,
  masjidId: UUID,
  now: Date,
): Promise<{ followers: number; itemsThisWeek: number; ameenThisWeek: number }> {
  requireOwnMasjid(scope, masjidId);
  const db = await handle.db();
  const stats = await scoped({ scope, db }, 'masjid_stats').findOne({ _id: masjidId });
  const itemsThisWeek = await scoped({ scope, db }, 'items').count({
    masjid_id: masjidId,
    status: 'published',
    published_at: { $gte: new Date(now.getTime() - WEEK_MS) },
  });
  return {
    followers: (stats && numberOf(stats, 'followers')) ?? 0,
    itemsThisWeek,
    ameenThisWeek: (stats && numberOf(stats, 'ameens_7d')) ?? 0,
  };
}

/**
 * Today's push quota (03 §4 `GET /notifications/quota`, 02 `push_quota_usage`): notifying publishes count against the
 * masjid's `push_daily_quota` per IST day; the count resets at the next midnight in India.
 *
 * @throws StateError `MASJID_NOT_FOUND` for a masjid outside the admin's scope.
 */
export async function getPushQuota(
  handle: DbHandle,
  scope: Scope,
  masjidId: UUID,
  now: Date,
): Promise<{ used: number; limit: number; resetsAt: Date }> {
  requireOwnMasjid(scope, masjidId);
  const db = await handle.db();
  const masjid = await scoped({ scope, db }, 'masjids').findOne({ _id: masjidId });
  if (!masjid) throw new StateError('MASJID_NOT_FOUND');
  const today = calendarDateInZone(now);
  const usage = await scoped({ scope, db }, 'push_quota_usage').findOne({ _id: quotaUsageId(masjidId, today) });
  return {
    used: (usage && numberOf(usage, 'count')) ?? 0,
    limit: numberOf(masjid, 'push_daily_quota') ?? 0,
    resetsAt: istInstant(addDays(today, 1), '00:00'),
  };
}

/**
 * What the admin's today strip and timings screens need to resolve times on the phone (`@mc/domain/prayer`): the
 * masjid's location and calculation settings plus its raw timings — the same shape as the musalli bundle's.
 *
 * @returns `timings: null` before the admin first saved timings.
 * @throws StateError `MASJID_NOT_FOUND` for a masjid outside the admin's scope.
 */
export async function getAdminSchedule(handle: DbHandle, scope: Scope, masjidId: UUID) {
  requireOwnMasjid(scope, masjidId);
  const db = await handle.db();
  const masjid = await scoped({ scope, db }, 'masjids').findOne({ _id: masjidId });
  if (!masjid) throw new StateError('MASJID_NOT_FOUND');
  const timings = await scoped({ scope, db }, 'masjid_timings').findOne({ _id: masjidId });
  return {
    masjid: compact({
      name: need(masjid, 'name'),
      lat: numberOf(masjid, 'lat') ?? 0,
      lng: numberOf(masjid, 'lng') ?? 0,
      calcMethod: oneOf(masjid, 'calc_method', CALC_METHOD),
      asrMadhab: oneOf(masjid, 'asr_madhab', ASR_MADHAB),
      hijriOffset: numberOf(masjid, 'hijri_offset'),
    }),
    timings: timings ? timingsOf(timings) : null,
    /** Sent back in `If-Match` when saving (0 = no timings yet — PHASE_03 T3.2). */
    rev: timings ? (numberOf(timings, 'rev') ?? 0) : 0,
  };
}

const SPECIAL_DATES_MAX = 200;

/**
 * The masjid's special dates from `fromDate` on, by date (07 B11 list; deleted ones left out).
 *
 * @param fromDate - "YYYY-MM-DD" (the screen asks from 30 days ago).
 * @throws StateError `MASJID_NOT_FOUND` for a masjid outside the admin's scope.
 */
export async function listSpecialDates(handle: DbHandle, scope: Scope, masjidId: UUID, fromDate: string) {
  requireOwnMasjid(scope, masjidId);
  const db = await handle.db();
  const docs = await scoped({ scope, db }, 'special_timings').find(
    { masjid_id: masjidId, date: { $gte: fromDate }, deleted_at: { $exists: false } },
    { sort: { date: 1, created_at: 1 }, limit: SPECIAL_DATES_MAX },
  );
  return docs.map((doc) =>
    compact({
      id: idOf(doc),
      type: oneOf(doc, 'type', SPECIAL_TYPE),
      date: need(doc, 'date'),
      label: text(doc, 'label'),
      times: arrayOf(doc, 'times').map((slot) => compact({ time: need(slot, 'time'), label: text(slot, 'label') })),
      note: text(doc, 'note'),
    }),
  );
}

/**
 * Ramadan mode and the Sehri / Iftar precautions (03 §4 `GET /ramadan`).
 *
 * @returns `start`/`end` `null` while Ramadan mode is off.
 * @throws StateError `MASJID_NOT_FOUND` for a masjid outside the admin's scope.
 */
export async function getRamadan(handle: DbHandle, scope: Scope, masjidId: UUID) {
  requireOwnMasjid(scope, masjidId);
  const db = await handle.db();
  const masjid = await scoped({ scope, db }, 'masjids').findOne({ _id: masjidId });
  if (!masjid) throw new StateError('MASJID_NOT_FOUND');
  const start = text(masjid, 'ramadan_start');
  const end = text(masjid, 'ramadan_end');
  const on = start !== undefined && end !== undefined;
  return {
    start: on ? start : null,
    end: on ? end : null,
    sehriPrecaution: numberOf(masjid, 'sehri_precaution_min') ?? 0,
    iftarPrecaution: numberOf(masjid, 'iftar_precaution_min') ?? 0,
  };
}

/**
 * How many followers a notification for `audience` reaches now (03 §4 publish answer `targeted`, B5 success): follows
 * of the masjid with notifications on and not muted, whose Brother/Sister choice the audience includes — counted through
 * `v_admin_follow_audience` (no device ids).
 *
 * @throws StateError MASJID_NOT_FOUND for a masjid outside the admin's scope.
 */
export async function countNotifyAudience(
  handle: DbHandle,
  scope: Scope,
  masjidId: UUID,
  audience: 'everyone' | 'brothers' | 'sisters',
): Promise<number> {
  requireOwnMasjid(scope, masjidId);
  const db = await handle.db();
  return scoped({ scope, db }, 'v_admin_follow_audience').count({
    masjid_id: masjidId,
    muted: false,
    push_active: true,
    audience_pref: { $in: audience === 'everyone' ? ['brothers', 'sisters'] : [audience] },
  });
}
