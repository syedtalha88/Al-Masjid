// Takedown (05 §3, 03 §5 Moderation, PHASE_08 T8.2): the Super Admin removes a post (★ step-up) — it disappears for
// everyone at once (status `removed`, version bump, purge marker for the 180-day preservation — IT Rules 3(1)(g)) and
// its open reports are closed as actioned; restores a removed or auto-hidden post (★); dismisses a report. Generic
// writes can never set these fields (policy `itemCheck`), so they are written here, in one transaction each.
import type { ClientSession, Db, UUID } from 'mongodb';

import { type DbHandle, withTransaction } from '../client.ts';
import { contentWrite, markItemForPurge, StateError, writeAudit } from '../effects.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText } from '../values.ts';
import { mirrorChandaTakedown } from './chanda.ts';
import { requireSuper } from './guards.ts';
import { linkRemovalToLegalOrder } from './legal-orders.ts';

interface ItemDoc {
  _id: UUID;
  masjid_id: UUID;
  public_id: string;
  type: string;
  status: string;
}

export interface RemovedItem {
  readonly masjidId: UUID;
  readonly publicId: string;
  /** Admins of the masjid to tell ("A post was removed: <category>"). */
  readonly adminIds: readonly UUID[];
  /** Open reports closed as actioned with this removal. */
  readonly reportsClosed: number;
}

const loadItem = async (db: Db, session: ClientSession, itemId: UUID) =>
  db
    .collection<ItemDoc>('items')
    .findOne({ _id: itemId }, { session, projection: { masjid_id: 1, public_id: 1, type: 1, status: 1 } });

/**
 * The public id and masjid of a post (C5 "Clear the cache again", security review M1): the route purges by these and
 * never takes them from the request.
 *
 * @throws StateError FORBIDDEN (not the Super Admin), ITEM_NOT_FOUND.
 */
export async function itemPurgeRef(
  handle: DbHandle,
  scope: Scope,
  itemId: UUID,
): Promise<{ readonly publicId: string; readonly masjidId: UUID }> {
  requireSuper(scope);
  const item = await (
    await handle.db()
  )
    .collection<ItemDoc>('items')
    .findOne({ _id: itemId }, { projection: { masjid_id: 1, public_id: 1 } });
  if (!item) throw new StateError('ITEM_NOT_FOUND');
  return { publicId: item.public_id, masjidId: item.masjid_id };
}

/**
 * ★ Removes a published or auto-hidden post (C5): hidden for everyone now, preserved privately for 180 days, the
 * masjid's version bumped (every cached response moves on), every open report on it closed as actioned, audited as
 * `item.remove` (category and counts only — never the note). The caller purges the CDN and tells the masjid's admins.
 *
 * @param input.category - the reason category the masjid sees (`MODERATION_CATEGORIES`, validated by the API).
 * @param input.note - the Super Admin's private note (≤ 500), kept on the item for the preservation period.
 * @returns what the caller needs for the CDN purge and the admins' alert.
 * @throws StateError FORBIDDEN, STEP_UP_REQUIRED, ITEM_NOT_FOUND (no such post, or not published / hidden — a deleted
 *   post is already gone and keeps its own preservation), ITEM_ALREADY_REMOVED.
 */
export async function removeItem(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly itemId: UUID;
    readonly category: string;
    readonly note?: string | undefined;
    /** ★ Remove in answer to a legal order (T8.5): logged on the order; a `received` order becomes `actioned`. */
    readonly legalOrderId?: UUID | undefined;
    readonly now: Date;
    readonly requestId?: string | undefined;
  },
): Promise<RemovedItem> {
  const actor = requireSuper(scope, { stepUp: true, now: input.now });
  return withTransaction(handle, scope, async (ctx) => {
    const item = await loadItem(ctx.db, ctx.session, input.itemId);
    if (item?.status === 'removed') throw new StateError('ITEM_ALREADY_REMOVED');
    if (!item || (item.status !== 'published' && item.status !== 'hidden')) throw new StateError('ITEM_NOT_FOUND');
    await contentWrite(ctx, item.masjid_id, async (store) => {
      // Moderation fields are refused to every generic write (policy `itemCheck`): written directly, in this transaction.
      const result = await store.db.collection<ItemDoc>('items').updateOne(
        { _id: input.itemId, status: { $in: ['published', 'hidden'] } },
        {
          $set: {
            status: 'removed',
            removed_at: input.now,
            removed_reason: input.category,
            updated_at: input.now,
            ...(input.note ? { removed_note: input.note } : {}),
          },
          $unset: { hidden_at: '' },
        },
        { session: store.session },
      );
      if (result.matchedCount !== 1) throw new StateError('ITEM_NOT_FOUND');
      await markItemForPurge(store, item.masjid_id, input.itemId, input.now);
      await mirrorChandaTakedown(store, item, true, input.now); // a chanda post's week goes with it (#180 M6)
    });
    const reportsClosed = await scoped(ctx, 'reports').updateMany(
      { target_type: 'item', target_id: input.itemId, status: 'open' },
      { $set: { status: 'actioned', actioned_by: actor.adminId, actioned_at: input.now, closed_at: input.now } },
    );
    if (input.legalOrderId) {
      await linkRemovalToLegalOrder(ctx, {
        orderId: input.legalOrderId,
        adminId: actor.adminId,
        publicId: item.public_id,
        now: input.now,
      });
    }
    const admins = await ctx.db
      .collection<{ admin_id: UUID }>('masjid_admins')
      .find({ masjid_id: item.masjid_id }, { session: ctx.session, projection: { admin_id: 1 } })
      .toArray();
    await writeAudit(ctx, {
      action: 'item.remove',
      masjidId: item.masjid_id,
      targetType: 'items',
      targetId: idText(item._id),
      meta: {
        type: item.type,
        category: input.category,
        reports: reportsClosed,
        was: item.status,
        ...(input.legalOrderId ? { legal_order: idText(input.legalOrderId) } : {}),
      },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return {
      masjidId: item.masjid_id,
      publicId: item.public_id,
      adminIds: admins.map((row) => row.admin_id),
      reportsClosed,
    };
  });
}

/**
 * ★ Restores a removed or auto-hidden post (C5): published again, the moderation fields and the purge marker cleared,
 * version bumped, audited as `item.restore`. Restoring an auto-hidden post dismisses the reports that hid it, so the
 * next report within the hour does not hide it again (DECISIONS #170).
 *
 * @returns the masjid and public id (the caller purges the CDN).
 * @throws StateError FORBIDDEN, STEP_UP_REQUIRED, ITEM_NOT_FOUND (not removed / hidden).
 */
export async function restoreItem(
  handle: DbHandle,
  scope: Scope,
  input: { readonly itemId: UUID; readonly now: Date; readonly requestId?: string | undefined },
): Promise<{ readonly masjidId: UUID; readonly publicId: string; readonly reportsDismissed: number }> {
  const actor = requireSuper(scope, { stepUp: true, now: input.now });
  return withTransaction(handle, scope, async (ctx) => {
    const item = await loadItem(ctx.db, ctx.session, input.itemId);
    if (!item || (item.status !== 'removed' && item.status !== 'hidden')) throw new StateError('ITEM_NOT_FOUND');
    await contentWrite(ctx, item.masjid_id, async (store) => {
      const result = await store.db.collection<ItemDoc>('items').updateOne(
        { _id: input.itemId, status: item.status },
        {
          $set: { status: 'published', updated_at: input.now },
          $unset: { removed_at: '', removed_reason: '', removed_note: '', purge_after: '', hidden_at: '' },
        },
        { session: store.session },
      );
      if (result.matchedCount !== 1) throw new StateError('ITEM_NOT_FOUND');
      await mirrorChandaTakedown(store, item, false, input.now); // the week follows "Show chanda" again (#180 M6)
    });
    const reportsDismissed = await scoped(ctx, 'reports').updateMany(
      { target_type: 'item', target_id: input.itemId, status: 'open' },
      { $set: { status: 'dismissed', actioned_by: actor.adminId, actioned_at: input.now, closed_at: input.now } },
    );
    await writeAudit(ctx, {
      action: 'item.restore',
      masjidId: item.masjid_id,
      targetType: 'items',
      targetId: idText(item._id),
      meta: { type: item.type, was: item.status, reports: reportsDismissed },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return { masjidId: item.masjid_id, publicId: item.public_id, reportsDismissed };
  });
}

/**
 * Dismisses one open report (C5 "Dismiss" — nothing wrong with the target), with an optional private note. An urgent
 * report (2 h clock) needs a step-up within the last 5 minutes (★, #180 L3).
 *
 * @throws StateError FORBIDDEN (not the Super Admin), STEP_UP_REQUIRED (urgent, no fresh step-up), REPORT_NOT_FOUND (no
 *   open report with that id).
 */
export async function dismissReport(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly reportId: UUID;
    readonly note?: string | undefined;
    readonly now: Date;
    readonly requestId?: string | undefined;
  },
): Promise<void> {
  const actor = requireSuper(scope);
  await withTransaction(handle, scope, async (ctx) => {
    // Dismissing an urgent report (private information, child safety — 2 h clock) is ★ (#180 L3).
    const report = await scoped(ctx, 'reports').findOne({ _id: input.reportId, status: 'open' });
    if (report?.['urgent'] === true) requireSuper(scope, { stepUp: true, now: input.now });
    const changed = await scoped(ctx, 'reports').updateOne(
      { _id: input.reportId, status: 'open' },
      {
        $set: {
          status: 'dismissed',
          actioned_by: actor.adminId,
          actioned_at: input.now,
          closed_at: input.now,
          ...(input.note ? { resolution_note: input.note } : {}),
        },
      },
    );
    if (changed !== 1) throw new StateError('REPORT_NOT_FOUND');
    await writeAudit(ctx, {
      action: 'report.dismiss',
      targetType: 'reports',
      targetId: idText(input.reportId),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
}
