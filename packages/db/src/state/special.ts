// Special dates and Ramadan mode (00 §4.2, 03 §4 `/special`, `/ramadan`, PHASE_03 T3.3): the masjid admin's writes,
// each in one transaction with the version bump (followers refetch the bundle), the audit entry and — when a special
// date is saved with "Notify followers" — a `timing_update` item ("Special timings", system template) with its outbox
// job. The rules are `@mc/domain/special`'s, checked against today in IST.
import { canSaveRamadan, validateRamadan, validateSpecialDate } from '@mc/domain/special';
import { calendarDateInZone } from '@mc/domain/time';
import type { Document, UUID } from 'mongodb';

import { type DbHandle, type TxContext, withTransaction } from '../client.ts';
import { contentWrite, StateError, writeAudit } from '../effects.ts';
import { requireOwnMasjid } from '../repos/admin.ts';
import { numberOf } from '../repos/read.ts';
import type { SPECIAL_TYPE } from '../schema/enums.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText, newId } from '../values.ts';
import { publishTimingUpdate } from './publish.ts';

/** The system template a special date is announced with (`@mc/i18n/templates`; param `date`). */
export const SPECIAL_TIMINGS_TEMPLATE = 'special_timings';

/** A special date as the admin saves it (the contracts checked lengths and formats). */
export interface SpecialDateInput {
  readonly type: (typeof SPECIAL_TYPE)[number];
  /** "YYYY-MM-DD". */
  readonly date: string;
  readonly label?: string | undefined;
  /** 1–5, in the admin's order. */
  readonly times: readonly { readonly time: string; readonly label?: string | undefined }[];
  readonly note?: string | undefined;
}

export interface RamadanInput {
  /** Both "YYYY-MM-DD", or both `null` (Ramadan mode off). */
  readonly start: string | null;
  readonly end: string | null;
  readonly sehriPrecautionMin: number;
  readonly iftarPrecautionMin: number;
}

interface WriteOptions {
  readonly masjidId: UUID;
  readonly requestId?: string | undefined;
  readonly now?: Date | undefined;
}

const fieldsOf = (entry: SpecialDateInput) => ({
  set: {
    type: entry.type,
    date: entry.date,
    ...(entry.label === undefined ? {} : { label: entry.label }),
    times: entry.times.map((slot) => ({ time: slot.time, ...(slot.label === undefined ? {} : { label: slot.label }) })),
    ...(entry.note === undefined ? {} : { note: entry.note }),
  },
  unset: {
    ...(entry.label === undefined ? { label: '' } : {}),
    ...(entry.note === undefined ? { note: '' } : {}),
  },
});

/** The admin's masjid inside the transaction (`MASJID_NOT_FOUND` outside the scope). */
async function ownMasjid(ctx: TxContext, masjidId: UUID): Promise<Document> {
  const masjid = await scoped(ctx, 'masjids').findOne({ _id: masjidId });
  if (!masjid) throw new StateError('MASJID_NOT_FOUND');
  return masjid;
}

function adminOf(scope: Scope, masjidId: UUID): UUID {
  requireOwnMasjid(scope, masjidId);
  if (scope.kind !== 'admin') throw new StateError('FORBIDDEN');
  return scope.adminId;
}

/**
 * Adds a special date (or, with `id`, replaces one — a label or note left out is removed).
 *
 * @param input.notify - "Notify followers": publishes a `timing_update` item for the date and its pending outbox job.
 * @returns the entry's id and, when notifying, the item's public id.
 * @throws StateError MASJID_NOT_FOUND (outside the scope), SPECIAL_DATE_NOT_FOUND (unknown or deleted `id`),
 *   SPECIAL_DATE_INVALID (a `@mc/domain/special` rule fails), NOTIFY_QUOTA_EXCEEDED.
 */
export async function saveSpecialDate(
  handle: DbHandle,
  scope: Scope,
  input: WriteOptions & { readonly id?: UUID; readonly entry: SpecialDateInput; readonly notify: boolean },
): Promise<{ id: string; item: { publicId: string } | null }> {
  const adminId = adminOf(scope, input.masjidId);
  const now = input.now ?? new Date();
  if (validateSpecialDate(input.entry, calendarDateInZone(now)).length > 0)
    throw new StateError('SPECIAL_DATE_INVALID');
  const { set, unset } = fieldsOf(input.entry);

  return withTransaction(handle, scope, async (ctx) => {
    const masjid = await ownMasjid(ctx, input.masjidId);
    const visible = masjid['status'] === 'active';
    const version = (numberOf(masjid, 'content_version') ?? 0) + 1;
    const id = input.id ?? newId();

    const item = await contentWrite(ctx, input.masjidId, async (content) => {
      const store = scoped(content, 'special_timings');
      if (input.id === undefined) {
        await store.insertOne({
          _id: id,
          masjid_id: input.masjidId,
          ...set,
          masjid_visible: visible,
          created_by: adminId,
          created_at: now,
          updated_at: now,
        });
      } else {
        const matched = await store.updateOne(
          { _id: id, masjid_id: input.masjidId, deleted_at: { $exists: false } },
          { $set: { ...set, updated_at: now }, ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}) },
        );
        if (matched !== 1) throw new StateError('SPECIAL_DATE_NOT_FOUND');
      }
      if (!input.notify) return null;
      return publishTimingUpdate(
        content,
        {
          templateKey: SPECIAL_TIMINGS_TEMPLATE,
          templateParams: { date: input.entry.date },
          createdBy: adminId,
          masjidVisible: visible,
          version,
          limit: numberOf(masjid, 'push_daily_quota') ?? 0,
        },
        now,
      );
    });
    await writeAudit(ctx, {
      action: input.id === undefined ? 'special.create' : 'special.update',
      masjidId: input.masjidId,
      targetType: 'special_timings',
      targetId: idText(id),
      meta: { type: input.entry.type, notify: input.notify },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return { id: idText(id), item };
  });
}

/**
 * Deletes a special date (soft: `deleted_at` — the public view hides it, followers' next poll drops it).
 *
 * @throws StateError MASJID_NOT_FOUND (outside the scope), SPECIAL_DATE_NOT_FOUND (unknown or already deleted).
 */
export async function deleteSpecialDate(
  handle: DbHandle,
  scope: Scope,
  input: WriteOptions & { readonly id: UUID },
): Promise<void> {
  adminOf(scope, input.masjidId);
  const now = input.now ?? new Date();
  await withTransaction(handle, scope, async (ctx) => {
    await ownMasjid(ctx, input.masjidId);
    await contentWrite(ctx, input.masjidId, async (content) => {
      const matched = await scoped(content, 'special_timings').updateOne(
        { _id: input.id, masjid_id: input.masjidId, deleted_at: { $exists: false } },
        { $set: { deleted_at: now, updated_at: now } },
      );
      if (matched !== 1) throw new StateError('SPECIAL_DATE_NOT_FOUND');
    });
    await writeAudit(ctx, {
      action: 'special.delete',
      masjidId: input.masjidId,
      targetType: 'special_timings',
      targetId: idText(input.id),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
}

/**
 * Saves Ramadan mode (on from `start` to `end`, or off) and the Sehri / Iftar precautions (00 §4.2).
 *
 * @throws StateError MASJID_NOT_FOUND (outside the scope), RAMADAN_INVALID (start and end not set together, or a
 *   `@mc/domain/special` rule fails; the precaution ranges are the contracts' and the validator's).
 */
export async function saveRamadan(
  handle: DbHandle,
  scope: Scope,
  input: WriteOptions & { readonly ramadan: RamadanInput },
): Promise<void> {
  adminOf(scope, input.masjidId);
  const now = input.now ?? new Date();
  const { start, end, sehriPrecautionMin, iftarPrecautionMin } = input.ramadan;
  if ((start === null) !== (end === null)) throw new StateError('RAMADAN_INVALID');
  if (start !== null && end !== null && !canSaveRamadan(validateRamadan({ start, end }, calendarDateInZone(now)))) {
    throw new StateError('RAMADAN_INVALID');
  }
  const precautions = { sehri_precaution_min: sehriPrecautionMin, iftar_precaution_min: iftarPrecautionMin };

  await withTransaction(handle, scope, async (ctx) => {
    await ownMasjid(ctx, input.masjidId);
    await contentWrite(ctx, input.masjidId, async (content) => {
      await scoped(content, 'masjids').updateOne(
        { _id: input.masjidId },
        start !== null && end !== null
          ? { $set: { ramadan_start: start, ramadan_end: end, ...precautions, updated_at: now } }
          : { $set: { ...precautions, updated_at: now }, $unset: { ramadan_start: '', ramadan_end: '' } },
      );
    });
    await writeAudit(ctx, {
      action: 'ramadan.update',
      masjidId: input.masjidId,
      targetType: 'masjids',
      targetId: idText(input.masjidId),
      meta: { on: start !== null },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
}
