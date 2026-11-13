// Legal orders register (05 §3, 07 C7, PHASE_08 T8.5): the Super Admin records an order from an authority with the
// time it was received (entered — it may have arrived by post or e-mail earlier); due = received + 3 h
// (`SLA_MS.legalOrder`, passed in by the API). The order names its target (a post, a masjid, or something outside the
// app), keeps an append-only action log (≤ 200 entries) and moves through received → actioned / contested → closed.
// A post named in an open order is held from purging (#165 L3). The order's document is stored encrypted outside the
// database (api-admin, DECISIONS #40) — only its storage key is kept here, and reading it is ★ and audited.
import type { UUID } from 'mongodb';

import { type DbHandle, withTransaction } from '../client.ts';
import { StateError, writeAudit } from '../effects.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText, isId, newId, parseId } from '../values.ts';
import { requireSuper } from './guards.ts';

export type LegalOrderStatus = 'received' | 'actioned' | 'contested' | 'closed';
/** What an order names: one of our posts (`items`), a masjid (`masjids`), or something outside the app (`other`). */
export type LegalTargetType = 'items' | 'masjids' | 'other';

/** The action log's upper bound (02 §2 legal_orders). */
export const LEGAL_ORDER_LOG_MAX = 200;

/**
 * The log with `entries` appended. Every caller read the order in the same transaction, so `$set` of the whole array
 * is as safe as `$push` (a concurrent change aborts the transaction), and the gateway's untyped update accepts it.
 */
const appendLog = (doc: Readonly<Record<string, unknown>>, entries: readonly object[]): unknown[] => {
  const log: unknown = doc['action_log'];
  const next = [...(Array.isArray(log) ? (log as unknown[]) : []), ...entries]; // the validator's array
  if (next.length > LEGAL_ORDER_LOG_MAX) throw new StateError('LEGAL_ORDER_LOG_FULL');
  return next;
};

/** Allowed status moves (closed is final). */
const NEXT: Readonly<Record<LegalOrderStatus, readonly LegalOrderStatus[]>> = {
  received: ['actioned', 'contested', 'closed'],
  actioned: ['contested', 'closed'],
  contested: ['actioned', 'closed'],
  closed: [],
};

/** A post's public id (its link `/p/<id>` or `/items/<id>`). */
const PUBLIC_ID = /^[A-Za-z0-9_-]{12}$/u;
/** A follow code as stored (8 characters; typed with or without its dash, any case). */
const FOLLOW_CODE = /^[0-9A-HJKMNP-TV-Z]{8}$/u;

/**
 * Resolves what the Super Admin typed as a target into the stored id: a post by its link, public id or id; a masjid by
 * its follow code or id; `other` is kept as typed.
 *
 * @throws StateError FORBIDDEN unless the Super Admin; LEGAL_TARGET_NOT_FOUND when no post / masjid matches.
 */
export async function resolveLegalTarget(
  handle: DbHandle,
  scope: Scope,
  input: { readonly type: LegalTargetType; readonly ref: string },
): Promise<{ readonly type: LegalTargetType; readonly id: string }> {
  requireSuper(scope);
  const ref = input.ref.trim();
  if (input.type === 'other') return { type: 'other', id: ref.slice(0, 64) };
  const ctx = { scope, db: await handle.db() };
  const last = ref.split(/[/?#]/u).filter(Boolean).at(-1) ?? '';
  if (input.type === 'items') {
    const asId = parseId(last);
    const filter = asId ? { _id: asId } : PUBLIC_ID.test(last) ? { public_id: last } : undefined;
    const [item] = filter ? await scoped(ctx, 'items').find(filter, { limit: 1 }) : [];
    const id: unknown = item?.['_id'];
    if (!isId(id)) throw new StateError('LEGAL_TARGET_NOT_FOUND');
    return { type: 'items', id: idText(id) };
  }
  const asId = parseId(last);
  const code = last.toUpperCase().replace(/-/gu, '');
  const filter = asId ? { _id: asId } : FOLLOW_CODE.test(code) ? { follow_code: code } : undefined;
  const [masjid] = filter ? await scoped(ctx, 'masjids').find(filter, { limit: 1 }) : [];
  const id: unknown = masjid?.['_id'];
  if (!isId(id)) throw new StateError('LEGAL_TARGET_NOT_FOUND');
  return { type: 'masjids', id: idText(id) };
}

/**
 * Records a new legal order (status `received`; the 3-hour clock starts at `receivedAt`).
 *
 * @param input.dueAt - received + `SLA_MS.legalOrder` (computed by the caller from the shared constant).
 * @returns the new order's id.
 * @throws StateError FORBIDDEN, STEP_UP_REQUIRED.
 */
export async function createLegalOrder(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly authority: string;
    readonly referenceNo: string;
    readonly receivedAt: Date;
    readonly dueAt: Date;
    readonly target: { readonly type: LegalTargetType; readonly id: string };
    readonly summary: string;
    readonly now: Date;
    readonly requestId?: string | undefined;
  },
): Promise<{ readonly id: UUID }> {
  const actor = requireSuper(scope, { stepUp: true, now: input.now });
  return withTransaction(handle, scope, async (ctx) => {
    const id = newId();
    await scoped(ctx, 'legal_orders').insertOne({
      _id: id,
      authority: input.authority,
      reference_no: input.referenceNo,
      received_at: input.receivedAt,
      due_at: input.dueAt,
      target_type: input.target.type,
      target_id: input.target.id,
      summary: input.summary,
      action_log: [{ at: input.now, by: actor.adminId, note: 'Order recorded' }],
      status: 'received',
      handled_by: actor.adminId,
      created_at: input.now,
      updated_at: input.now,
    });
    await writeAudit(ctx, {
      action: 'legal_order.create',
      targetType: 'legal_orders',
      targetId: idText(id),
      meta: { target_type: input.target.type },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return { id };
  });
}

export interface LegalOrderRow {
  readonly id: string;
  readonly authority: string;
  readonly referenceNo: string;
  readonly receivedAt: string;
  readonly dueAt: string;
  readonly targetType: LegalTargetType;
  readonly targetId: string;
  readonly summary: string;
  readonly actionTaken?: string;
  readonly actionLog: { readonly at: string; readonly note: string }[];
  readonly status: LegalOrderStatus;
  readonly hasDocument: boolean;
  readonly createdAt: string;
}

const iso = (value: unknown): string => (value instanceof Date ? value.toISOString() : '');

/**
 * The register (C7): open orders first by due time, then closed ones, newest first. Never the document's storage key.
 *
 * @throws StateError FORBIDDEN unless the Super Admin.
 */
export async function listLegalOrders(handle: DbHandle, scope: Scope): Promise<LegalOrderRow[]> {
  requireSuper(scope);
  const docs = await scoped({ scope, db: await handle.db() }, 'legal_orders').find(
    {},
    { sort: { received_at: -1 }, limit: 500 },
  );
  const rows = docs.flatMap((doc): LegalOrderRow[] => {
    const id: unknown = doc['_id'];
    if (!isId(id)) return [];
    const log: unknown = doc['action_log'];
    const actionTaken = typeof doc['action_taken'] === 'string' ? doc['action_taken'] : undefined;
    return [
      {
        id: idText(id),
        authority: String(doc['authority']),
        referenceNo: String(doc['reference_no']),
        receivedAt: iso(doc['received_at']),
        dueAt: iso(doc['due_at']),
        targetType: doc['target_type'] as LegalTargetType, // written only by createLegalOrder
        targetId: String(doc['target_id']),
        summary: String(doc['summary']),
        ...(actionTaken ? { actionTaken } : {}),
        actionLog: (Array.isArray(log) ? (log as { at?: unknown; note?: unknown }[]) : []).map((entry) => ({
          at: iso(entry.at),
          note: String(entry.note),
        })), // the validator's array of objects
        status: doc['status'] as LegalOrderStatus, // the validator's enum
        hasDocument: typeof doc['document_key'] === 'string',
        createdAt: iso(doc['created_at']),
      },
    ];
  });
  const closed = (row: LegalOrderRow) => row.status === 'closed';
  return rows.sort((a, b) =>
    closed(a) === closed(b)
      ? closed(a)
        ? b.receivedAt.localeCompare(a.receivedAt)
        : a.dueAt.localeCompare(b.dueAt)
      : closed(a)
        ? 1
        : -1,
  );
}

/**
 * Updates an order: a status move, the action taken and/or a note for the action log (each change is logged).
 *
 * @throws StateError FORBIDDEN, STEP_UP_REQUIRED, LEGAL_ORDER_NOT_FOUND, INVALID_TRANSITION (closed is final, or a move
 *   not in the flow), NOTHING_TO_UPDATE, LEGAL_ORDER_LOG_FULL (200 entries).
 */
export async function updateLegalOrder(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly id: UUID;
    readonly status?: LegalOrderStatus | undefined;
    readonly actionTaken?: string | undefined;
    readonly note?: string | undefined;
    readonly now: Date;
    readonly requestId?: string | undefined;
  },
): Promise<{ readonly status: LegalOrderStatus }> {
  const actor = requireSuper(scope, { stepUp: true, now: input.now });
  if (input.status === undefined && input.actionTaken === undefined && input.note === undefined) {
    throw new StateError('NOTHING_TO_UPDATE');
  }
  return withTransaction(handle, scope, async (ctx) => {
    const orders = scoped(ctx, 'legal_orders');
    const [doc] = await orders.find({ _id: input.id });
    if (!doc) throw new StateError('LEGAL_ORDER_NOT_FOUND');
    const from = doc['status'] as LegalOrderStatus; // the validator's enum
    const to = input.status ?? from;
    if (from === 'closed' || (to !== from && !NEXT[from].includes(to))) throw new StateError('INVALID_TRANSITION');
    const notes = [
      ...(to !== from ? [`Status: ${from} → ${to}`] : []),
      ...(input.actionTaken !== undefined ? ['Action taken updated'] : []),
      ...(input.note !== undefined ? [input.note] : []),
    ];
    await orders.updateOne(
      { _id: input.id, status: from },
      {
        $set: {
          status: to,
          action_log: appendLog(
            doc,
            notes.map((note) => ({ at: input.now, by: actor.adminId, note })),
          ),
          ...(input.actionTaken !== undefined ? { action_taken: input.actionTaken } : {}),
          handled_by: actor.adminId,
          updated_at: input.now,
        },
      },
    );
    await writeAudit(ctx, {
      action: 'legal_order.update',
      targetType: 'legal_orders',
      targetId: idText(input.id),
      meta: { from, to, ...(input.actionTaken !== undefined ? { action: true } : {}) },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return { status: to };
  });
}

/**
 * Links a takedown to an order inside the removal's transaction (★ Remove with `legalOrderId`): the log records the
 * post, a `received` order becomes `actioned` (its clock stops).
 *
 * @throws StateError LEGAL_ORDER_NOT_FOUND (none, or closed), LEGAL_ORDER_LOG_FULL.
 */
export async function linkRemovalToLegalOrder(
  ctx: Parameters<typeof scoped>[0],
  input: { readonly orderId: UUID; readonly adminId: UUID; readonly publicId: string; readonly now: Date },
): Promise<void> {
  const orders = scoped(ctx, 'legal_orders');
  const [doc] = await orders.find({ _id: input.orderId, status: { $ne: 'closed' } });
  if (!doc) throw new StateError('LEGAL_ORDER_NOT_FOUND');
  await orders.updateOne(
    { _id: input.orderId },
    {
      $set: {
        ...(doc['status'] === 'received' ? { status: 'actioned' } : {}),
        handled_by: input.adminId,
        updated_at: input.now,
        action_log: appendLog(doc, [{ at: input.now, by: input.adminId, note: `Post ${input.publicId} removed` }]),
      },
    },
  );
}

/**
 * Records the order's (encrypted) document after api-admin stored it; returns the key it replaced, which the caller
 * deletes from storage. Audited as `legal_order.document`.
 *
 * @throws StateError FORBIDDEN, STEP_UP_REQUIRED, LEGAL_ORDER_NOT_FOUND.
 */
export async function setLegalOrderDocument(
  handle: DbHandle,
  scope: Scope,
  input: { readonly id: UUID; readonly key: string; readonly now: Date; readonly requestId?: string | undefined },
): Promise<{ readonly replaced?: string }> {
  const actor = requireSuper(scope, { stepUp: true, now: input.now });
  return withTransaction(handle, scope, async (ctx) => {
    const orders = scoped(ctx, 'legal_orders');
    const [doc] = await orders.find({ _id: input.id });
    if (!doc) throw new StateError('LEGAL_ORDER_NOT_FOUND');
    const previous: unknown = doc['document_key'];
    await orders.updateOne(
      { _id: input.id },
      {
        $set: {
          document_key: input.key,
          handled_by: actor.adminId,
          updated_at: input.now,
          action_log: appendLog(doc, [{ at: input.now, by: actor.adminId, note: 'Document uploaded' }]),
        },
      },
    );
    await writeAudit(ctx, {
      action: 'legal_order.document',
      targetType: 'legal_orders',
      targetId: idText(input.id),
      meta: { replaced: typeof previous === 'string' },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return typeof previous === 'string' ? { replaced: previous } : {};
  });
}

/**
 * ★ The storage key of the order's document and its reference number (for the file name) — audited as
 * `legal_order.document_read` before it is returned.
 *
 * @throws StateError FORBIDDEN, STEP_UP_REQUIRED, LEGAL_ORDER_NOT_FOUND (no order, or it has no document).
 */
export async function readLegalOrderDocument(
  handle: DbHandle,
  scope: Scope,
  input: { readonly id: UUID; readonly now: Date; readonly requestId?: string | undefined },
): Promise<{ readonly key: string; readonly referenceNo: string }> {
  requireSuper(scope, { stepUp: true, now: input.now });
  return withTransaction(handle, scope, async (ctx) => {
    const [doc] = await scoped(ctx, 'legal_orders').find({ _id: input.id });
    const key: unknown = doc?.['document_key'];
    if (!doc || typeof key !== 'string') throw new StateError('LEGAL_ORDER_NOT_FOUND');
    await writeAudit(ctx, {
      action: 'legal_order.document_read',
      targetType: 'legal_orders',
      targetId: idText(input.id),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return { key, referenceNo: String(doc['reference_no']) };
  });
}
