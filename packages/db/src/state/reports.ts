// Reports (02 §2 reports, 05 §3, PHASE_08 T8.1): a musalli device reports a published post or a masjid; the worker's
// `report-triage` job then raises the immediate Super Admin alert for urgent reports and auto-hides an item that many
// distinct devices reported within an hour. The public API's database user may only insert reports (02 §4.3), so
// everything that reads them runs here under `systemScope()`.
import type { ClientSession, UUID } from 'mongodb';

import { type DbHandle, withTransaction } from '../client.ts';
import { contentWrite, StateError, writeAudit } from '../effects.ts';
import type { REPORT_REASON } from '../schema/enums.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText, newId } from '../values.ts';
import { mirrorChandaTakedown } from './chanda.ts';

export type ReportReasonValue = (typeof REPORT_REASON)[number];

export type ReportTarget =
  { readonly kind: 'item'; readonly publicId: string } | { readonly kind: 'masjid'; readonly masjidId: UUID };

export interface ReportInput {
  readonly target: ReportTarget;
  readonly reason: ReportReasonValue;
  readonly details?: string | undefined;
  /** From `reportSla()` in `@mc/shared/compliance` — the API owns the timelines (05 §3). */
  readonly urgent: boolean;
  readonly slaDueAt: Date;
  readonly now: Date;
}

/**
 * Records a report from this device (03 §3 `POST /reports`, after the API verified Turnstile and the daily limit).
 * The target must be visible to the public right now: a published post (any audience) or an active masjid.
 *
 * @returns the report's id (never shown to the reporter beyond "thank you").
 * @throws StateError FORBIDDEN (not a device scope), TARGET_NOT_FOUND (no such public post / masjid).
 */
export async function createReport(handle: DbHandle, scope: Scope, input: ReportInput): Promise<UUID> {
  if (scope.kind !== 'device') throw new StateError('FORBIDDEN');
  const deviceId = scope.deviceId;
  return withTransaction(handle, scope, async (ctx) => {
    const session = { session: ctx.session };
    let targetId: UUID;
    let masjidId: UUID;
    if (input.target.kind === 'item') {
      const item = await ctx.db
        .collection<{ _id: UUID; masjid_id: UUID }>('v_pub_items')
        .findOne({ public_id: input.target.publicId }, { ...session, projection: { _id: 1, masjid_id: 1 } });
      if (!item) throw new StateError('TARGET_NOT_FOUND');
      targetId = item._id;
      masjidId = item.masjid_id;
    } else {
      const masjid = await ctx.db
        .collection<{ _id: UUID }>('v_pub_masjids')
        .findOne({ _id: input.target.masjidId }, { ...session, projection: { _id: 1 } });
      if (!masjid) throw new StateError('TARGET_NOT_FOUND');
      targetId = masjid._id;
      masjidId = masjid._id;
    }
    const id = newId();
    await scoped(ctx, 'reports').insertOne({
      _id: id,
      target_type: input.target.kind,
      target_id: targetId,
      masjid_id: masjidId,
      reason: input.reason,
      ...(input.details ? { details: input.details } : {}),
      device_id: deviceId,
      urgent: input.urgent,
      status: 'open',
      sla_due_at: input.slaDueAt,
      created_at: input.now,
    });
    return id;
  });
}

export interface UntriagedReport {
  readonly id: UUID;
  readonly targetType: 'item' | 'masjid';
  readonly targetId: UUID;
  readonly masjidId: UUID;
  readonly urgent: boolean;
}

/** One triage pass looks at this many new reports at most (the job runs every minute). */
export const TRIAGE_BATCH = 500;

/**
 * The open reports `report-triage` has not looked at yet, oldest first.
 *
 * @throws StateError FORBIDDEN unless `systemScope()`.
 */
export async function listUntriagedReports(handle: DbHandle, scope: Scope): Promise<UntriagedReport[]> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  const docs = await (
    await handle.db()
  )
    .collection<{
      _id: UUID;
      target_type: 'item' | 'masjid';
      target_id: UUID;
      masjid_id: UUID;
      urgent: boolean;
    }>('reports')
    .find(
      { status: 'open', triaged_at: { $exists: false } },
      {
        sort: { created_at: 1 },
        limit: TRIAGE_BATCH,
        projection: { target_type: 1, target_id: 1, masjid_id: 1, urgent: 1 },
      },
    )
    .toArray();
  return docs.map((doc) => ({
    id: doc._id,
    targetType: doc.target_type,
    targetId: doc.target_id,
    masjidId: doc.masjid_id,
    urgent: doc.urgent,
  }));
}

/**
 * Marks reports as looked at by `report-triage` (after their alerts were raised), so no report alerts twice.
 *
 * @returns how many were marked (already-marked ones are left alone).
 * @throws StateError FORBIDDEN unless `systemScope()`.
 */
export async function markReportsTriaged(
  handle: DbHandle,
  scope: Scope,
  reportIds: readonly UUID[],
  now: Date,
): Promise<number> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  if (reportIds.length === 0) return 0;
  const result = await (
    await handle.db()
  )
    .collection<{ _id: UUID }>('reports')
    .updateMany({ _id: { $in: [...reportIds] }, triaged_at: { $exists: false } }, { $set: { triaged_at: now } });
  return result.modifiedCount;
}

/**
 * How many distinct devices reported this item since `since` (open reports only — 05 §3 brigading guard).
 *
 * @throws StateError FORBIDDEN unless `systemScope()`.
 */
export async function countRecentReporters(handle: DbHandle, scope: Scope, itemId: UUID, since: Date): Promise<number> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  const devices = await (await handle.db()).collection<{ device_id?: UUID }>('reports').distinct('device_id', {
    target_type: 'item',
    target_id: itemId,
    status: 'open',
    created_at: { $gte: since },
    device_id: { $exists: true },
  });
  return devices.length;
}

/** The auto-hide threshold from settings (02 §2 `report_autohide_threshold`), `fallback` when unset. */
export async function readAutohideThreshold(handle: DbHandle, scope: Scope, fallback: number): Promise<number> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  const settings = await (
    await handle.db()
  )
    .collection<{ _id: string; report_autohide_threshold?: number }>('app_settings')
    .findOne({ _id: 'global' }, { projection: { report_autohide_threshold: 1 } });
  const value = settings?.report_autohide_threshold;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Auto-hides a published item pending review (status `hidden`, `hidden_at`; masjid version bumped so every cached
 * response moves on) and audits it as `item.autohide`. Only a published item changes, so a second call — or a
 * second triage pass — does nothing: the hide (and its alert) happens once.
 *
 * @param reporters - distinct devices that reported it within the window (audit meta).
 * @returns `hidden` when this call hid it, `unchanged` when it was not published, with the post's status now (so a
 *   caller can still raise a lost alert for a post that is already `hidden`) and its public id and masjid (the caller
 *   purges the CDN by them and re-checks its files — security review M4), and when it was hidden (`hiddenAt`: one hide
 *   = one alert / purge / file check, while a later hide after a restore gets its own — security re-review N-L2).
 * @throws StateError FORBIDDEN unless `systemScope()`.
 */
export async function autoHideItem(
  handle: DbHandle,
  scope: Scope,
  input: { readonly itemId: UUID; readonly reporters: number; readonly now: Date },
): Promise<{
  readonly result: 'hidden' | 'unchanged';
  readonly status: string | null;
  readonly target?: { readonly publicId: string; readonly masjidId: UUID };
  readonly hiddenAt?: Date;
}> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  return withTransaction(handle, scope, async (ctx) => {
    const options: { session: ClientSession } = { session: ctx.session };
    const item = await ctx.db
      .collection<{
        _id: UUID;
        masjid_id: UUID;
        public_id: string;
        status: string;
        type: string;
        hidden_at?: Date;
      }>('items')
      .findOne(
        { _id: input.itemId },
        { ...options, projection: { masjid_id: 1, public_id: 1, status: 1, type: 1, hidden_at: 1 } },
      );
    const target = item ? { publicId: item.public_id, masjidId: item.masjid_id } : undefined;
    if (item?.status !== 'published') {
      const hiddenAt = item?.status === 'hidden' && item.hidden_at instanceof Date ? item.hidden_at : undefined;
      return {
        result: 'unchanged' as const,
        status: item?.status ?? null,
        ...(target ? { target } : {}),
        ...(hiddenAt ? { hiddenAt } : {}),
      };
    }
    await contentWrite(ctx, item.masjid_id, async (store) => {
      const matched = await scoped(store, 'items').updateOne(
        { _id: input.itemId, status: 'published' },
        { $set: { status: 'hidden', hidden_at: input.now, updated_at: input.now } },
      );
      if (matched !== 1) throw new StateError('ITEM_NOT_FOUND');
      await mirrorChandaTakedown(store, item, true, input.now); // a chanda post's week goes with it (#180 M6)
    });
    await writeAudit(ctx, {
      action: 'item.autohide',
      masjidId: item.masjid_id,
      targetType: 'items',
      targetId: idText(item._id),
      meta: { type: item.type, reporters: input.reporters },
    });
    return { result: 'hidden' as const, status: 'hidden', ...(target ? { target } : {}), hiddenAt: input.now };
  });
}
