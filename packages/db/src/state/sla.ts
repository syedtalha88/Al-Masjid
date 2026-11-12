// SLA timers (05 §3, 07 C1, PHASE_08 T8.3): every open thing with a legal deadline, read as one list — today open
// reports (urgent: 2 h, others: 36 h); grievances (T8.4) and legal orders (T8.5) join here. The `sla-alerts` job asks
// for the timers, sends the Super Admin one alert per (target, threshold) and records the threshold on the target.
import type { UUID } from 'mongodb';

import type { DbHandle } from '../client.ts';
import { StateError } from '../effects.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { isId } from '../values.ts';

export type SlaKind = 'urgent_report' | 'report';

export interface SlaTimer {
  readonly kind: SlaKind;
  readonly id: UUID;
  readonly masjidId: UUID | undefined;
  /** When the clock started (received). */
  readonly startAt: Date;
  readonly dueAt: Date;
  /** The highest alert already sent (0 = none). */
  readonly alerted: number;
}

/** At most this many timers are read at once (oldest due first). */
export const SLA_TIMERS_MAX = 500;

/**
 * The open timers, earliest due first — for the system's `sla-alerts` job and the Super Admin's dashboard (C1).
 *
 * @throws StateError FORBIDDEN unless the system or the Super Admin.
 */
export async function listSlaTimers(handle: DbHandle, scope: Scope): Promise<SlaTimer[]> {
  if (scope.kind !== 'system' && scope.kind !== 'super') throw new StateError('FORBIDDEN');
  const db = await handle.db();
  const reports = await scoped({ scope, db }, 'reports').find(
    { status: 'open' },
    { sort: { sla_due_at: 1, _id: 1 }, limit: SLA_TIMERS_MAX },
  );
  return reports.flatMap((doc): SlaTimer[] => {
    const id: unknown = doc['_id'];
    const masjidId: unknown = doc['masjid_id'];
    const startAt: unknown = doc['created_at'];
    const dueAt: unknown = doc['sla_due_at'];
    const alerted: unknown = doc['sla_alerted'];
    if (!isId(id) || !(startAt instanceof Date) || !(dueAt instanceof Date)) return [];
    return [
      {
        kind: doc['urgent'] === true ? 'urgent_report' : 'report',
        id,
        masjidId: isId(masjidId) ? masjidId : undefined,
        startAt,
        dueAt,
        alerted: typeof alerted === 'number' ? alerted : 0,
      },
    ];
  });
}

/**
 * Records that the alert for `level` was sent (only upwards — a lower level never overwrites a higher one).
 *
 * @throws StateError FORBIDDEN unless the system.
 */
export async function markSlaAlerted(
  handle: DbHandle,
  scope: Scope,
  timer: { readonly kind: SlaKind; readonly id: UUID },
  level: number,
): Promise<void> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  await (
    await handle.db()
  )
    .collection<{ _id: UUID; sla_alerted?: number }>('reports')
    .updateOne(
      { _id: timer.id, $or: [{ sla_alerted: { $exists: false } }, { sla_alerted: { $lt: level } }] },
      { $set: { sla_alerted: level } },
    );
}
