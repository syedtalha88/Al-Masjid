// Grievances (05 §3, 07 A15 §8 + C6, PHASE_08 T8.4): anyone files one from Settings → Contact & Grievance (public
// scope, after Turnstile) and gets a reference `GR-YYYY-NNNNNN`, sequential per year; the optional contact arrives
// sealed (api-public seals it with the public key — DECISIONS #173). The Super Admin acknowledges (24 h), resolves or
// rejects (72 h) and may reveal the contact (★ step-up, audited). The timers feed `listSlaTimers`.
import type { UUID } from 'mongodb';

import { type DbHandle, withTransaction } from '../client.ts';
import { StateError, writeAudit } from '../effects.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText, isId, newId, toInt64 } from '../values.ts';
import { requireSuper } from './guards.ts';

export type GrievanceCategory = 'privacy' | 'content' | 'technical' | 'feedback' | 'other';
export type GrievanceStatus = 'open' | 'acknowledged' | 'resolved' | 'rejected';

/** IST is UTC+5:30 all year: the reference's year is the year in India. */
const IST_MS = 330 * 60 * 1000;

/**
 * Files a grievance (public scope — `POST /grievances`, after Turnstile and the 5-a-day limit).
 *
 * @param input.seal - seals the contact with the reference as associated data (api-public, #173); absent = no contact.
 * @returns the reference shown to the person.
 * @throws StateError FORBIDDEN (not the public scope).
 */
export async function createGrievance(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly category: GrievanceCategory;
    readonly description: string;
    readonly seal?: ((publicRef: string) => string) | undefined;
    readonly ackDueAt: Date;
    readonly resolveDueAt: Date;
    readonly now: Date;
  },
): Promise<{ readonly publicRef: string }> {
  if (scope.kind !== 'public') throw new StateError('FORBIDDEN');
  const year = String(new Date(input.now.getTime() + IST_MS).getUTCFullYear());
  return withTransaction(handle, scope, async (ctx) => {
    const seq = scoped(ctx, 'grievance_seq');
    await seq.updateOne({ _id: year }, { $inc: { seq: toInt64(1) } }, { upsert: true });
    const [counter] = await seq.find({ _id: year });
    const value: unknown = counter?.['seq'];
    const n = typeof value === 'number' ? value : Number(value); // int64 → number (≤ 999,999 a year)
    const publicRef = `GR-${year}-${String(n).padStart(6, '0')}`;
    await scoped(ctx, 'grievances').insertOne({
      _id: newId(),
      public_ref: publicRef,
      category: input.category,
      description: input.description,
      ...(input.seal ? { contact_enc: input.seal(publicRef) } : {}),
      status: 'open',
      ack_due_at: input.ackDueAt,
      resolve_due_at: input.resolveDueAt,
      created_at: input.now,
    });
    return { publicRef };
  });
}

export interface GrievanceRow {
  readonly id: string;
  readonly publicRef: string;
  readonly category: GrievanceCategory;
  readonly description: string;
  readonly hasContact: boolean;
  readonly status: GrievanceStatus;
  readonly createdAt: string;
  readonly ackDueAt: string;
  readonly resolveDueAt: string;
  readonly acknowledgedAt?: string;
  readonly resolvedAt?: string;
  readonly resolution?: string;
}

const iso = (value: unknown): string | undefined => (value instanceof Date ? value.toISOString() : undefined);

/**
 * The tracker (C6): unfinished first by their next due time, then the finished ones, newest first. Never the contact.
 *
 * @throws StateError FORBIDDEN unless the Super Admin.
 */
export async function listGrievances(handle: DbHandle, scope: Scope): Promise<GrievanceRow[]> {
  requireSuper(scope);
  const docs = await scoped({ scope, db: await handle.db() }, 'grievances').find(
    {},
    { sort: { created_at: -1 }, limit: 500 },
  );
  const rows = docs.flatMap((doc): GrievanceRow[] => {
    const id: unknown = doc['_id'];
    if (!isId(id)) return [];
    const acknowledgedAt = iso(doc['acknowledged_at']);
    const resolvedAt = iso(doc['resolved_at']);
    const resolution = typeof doc['resolution'] === 'string' ? doc['resolution'] : undefined;
    return [
      {
        id: idText(id),
        publicRef: String(doc['public_ref']),
        category: doc['category'] as GrievanceCategory, // the validator's enum
        description: String(doc['description']),
        hasContact: typeof doc['contact_enc'] === 'string',
        status: doc['status'] as GrievanceStatus, // the validator's enum
        createdAt: iso(doc['created_at']) ?? '',
        ackDueAt: iso(doc['ack_due_at']) ?? '',
        resolveDueAt: iso(doc['resolve_due_at']) ?? '',
        ...(acknowledgedAt ? { acknowledgedAt } : {}),
        ...(resolvedAt ? { resolvedAt } : {}),
        ...(resolution ? { resolution } : {}),
      },
    ];
  });
  const due = (row: GrievanceRow) => (row.status === 'open' ? row.ackDueAt : row.resolveDueAt);
  const done = (row: GrievanceRow) => row.status === 'resolved' || row.status === 'rejected';
  return rows.sort((a, b) =>
    done(a) === done(b)
      ? done(a)
        ? b.createdAt.localeCompare(a.createdAt)
        : due(a).localeCompare(due(b))
      : done(a)
        ? 1
        : -1,
  );
}

/**
 * Acknowledges an open grievance (the 24 h clock stops; the resolve clock's alerts start again from zero).
 *
 * @throws StateError FORBIDDEN, GRIEVANCE_NOT_FOUND (no open grievance with that id).
 */
export async function acknowledgeGrievance(
  handle: DbHandle,
  scope: Scope,
  input: { readonly id: UUID; readonly now: Date; readonly requestId?: string | undefined },
): Promise<void> {
  const actor = requireSuper(scope);
  await withTransaction(handle, scope, async (ctx) => {
    const changed = await scoped(ctx, 'grievances').updateOne(
      { _id: input.id, status: 'open' },
      { $set: { status: 'acknowledged', acknowledged_at: input.now, handled_by: actor.adminId, sla_alerted: 0 } },
    );
    if (changed !== 1) throw new StateError('GRIEVANCE_NOT_FOUND');
    await writeAudit(ctx, {
      action: 'grievance.ack',
      targetType: 'grievances',
      targetId: idText(input.id),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
}

/**
 * Resolves or rejects a grievance with the note the Super Admin keeps (C6).
 *
 * @throws StateError FORBIDDEN, GRIEVANCE_NOT_FOUND (none open / acknowledged with that id).
 */
export async function resolveGrievance(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly id: UUID;
    readonly status: 'resolved' | 'rejected';
    readonly resolution: string;
    readonly now: Date;
    readonly requestId?: string | undefined;
  },
): Promise<void> {
  const actor = requireSuper(scope);
  await withTransaction(handle, scope, async (ctx) => {
    const changed = await scoped(ctx, 'grievances').updateOne(
      { _id: input.id, status: { $in: ['open', 'acknowledged'] } },
      {
        $set: {
          status: input.status,
          resolved_at: input.now,
          resolution: input.resolution,
          handled_by: actor.adminId,
        },
      },
    );
    if (changed !== 1) throw new StateError('GRIEVANCE_NOT_FOUND');
    await writeAudit(ctx, {
      action: 'grievance.resolve',
      targetType: 'grievances',
      targetId: idText(input.id),
      meta: { status: input.status },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
}

/**
 * ★ The sealed contact of a grievance and its reference (the API opens it with api-admin's private key) — audited
 * as `grievance.contact` before it is returned.
 *
 * @returns `null` when the person left no contact.
 * @throws StateError FORBIDDEN, STEP_UP_REQUIRED, GRIEVANCE_NOT_FOUND.
 */
export async function readGrievanceContact(
  handle: DbHandle,
  scope: Scope,
  input: { readonly id: UUID; readonly now: Date; readonly requestId?: string | undefined },
): Promise<{ readonly publicRef: string; readonly sealed: string } | null> {
  requireSuper(scope, { stepUp: true, now: input.now });
  return withTransaction(handle, scope, async (ctx) => {
    const [doc] = await scoped(ctx, 'grievances').find({ _id: input.id });
    if (!doc) throw new StateError('GRIEVANCE_NOT_FOUND');
    const sealed: unknown = doc['contact_enc'];
    if (typeof sealed !== 'string') return null;
    await writeAudit(ctx, {
      action: 'grievance.contact',
      targetType: 'grievances',
      targetId: idText(input.id),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return { publicRef: String(doc['public_ref']), sealed };
  });
}
