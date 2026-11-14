// Platform stats (02 §2 stats_snapshots, PHASE_08 T8.10): the hourly `stats-snapshot` job (worker, `mc_system`) counts
// what the Super Admin's Stats screen (07 C12) shows — masjids by status, devices by platform / locale / push status,
// follows, push delivery over 24 hours, the job queues' backlog, Cloudinary usage and how many report / grievance
// deadlines were met over 30 days — into one document per hour, and recomputes `masjid_stats.ameens_7d`. The Stats
// screen reads only these snapshots, never the large collections (devices and follows are never listed — 02 §4).
import type { Document, UUID } from 'mongodb';

import type { DbHandle } from '../client.ts';
import { StateError } from '../effects.ts';
import { LOCALE, MASJID_STATUS, PLATFORM, PUSH_STATUS } from '../schema/enums.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Deadlines are measured over the last 30 days (reports and grievances created then). */
export const SLA_WINDOW_MS = 30 * DAY_MS;
/** Ameens of the last 7 days (02 §2 masjid_stats.ameens_7d). */
const AMEEN_WINDOW_MS = 7 * DAY_MS;

/** The job queues at the time of the snapshot, all queues together (filled in by the worker). */
export interface QueueStats {
  readonly waiting: number;
  readonly active: number;
  readonly delayed: number;
  readonly failed: number;
  /** Age in seconds of the oldest job waiting to run (0 when none waits) — the "job lag". */
  readonly lagS: number;
}

/** Cloudinary's monthly usage (Admin API `GET /usage`), as far as the plan reports it. */
export interface CloudinaryStats {
  /** Credits used this month in % (`credits.used_percent`; plans without credits: the highest of storage, bandwidth, transformations). */
  readonly usedPercent: number;
  /** `credits.usage` / `credits.limit` when the plan reports credits. */
  readonly credits?: { readonly usage: number; readonly limit: number };
  readonly plan?: string;
}

/** On time vs late for one kind of deadline (late = done after its due time, or still open past it). */
export interface SlaTally {
  readonly onTime: number;
  readonly late: number;
}

export interface StatsCounts {
  readonly masjids: Readonly<Record<(typeof MASJID_STATUS)[number], number>>;
  readonly devices: {
    readonly total: number;
    readonly platform: Readonly<Record<(typeof PLATFORM)[number], number>>;
    readonly locale: Readonly<Record<(typeof LOCALE)[number], number>>;
    readonly push: Readonly<Record<(typeof PUSH_STATUS)[number], number>>;
  };
  readonly follows: number;
  /** Notification jobs created in the 24 hours before the snapshot. */
  readonly push24h: { readonly jobs: number; readonly sent: number; readonly failed: number };
  readonly sla: { readonly reports: SlaTally; readonly grievanceAck: SlaTally; readonly grievanceResolve: SlaTally };
  readonly queues?: QueueStats;
  readonly cloudinary?: CloudinaryStats;
}

export interface StatsSnapshot {
  /** The hour (`YYYY-MM-DDTHH`, UTC). */
  readonly hour: string;
  readonly at: Date;
  readonly counts: StatsCounts;
}

/** The snapshot id of an instant: its UTC hour. */
export const snapshotHour = (now: Date): string => now.toISOString().slice(0, 13);

const zeros = <K extends string>(keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>; // every key set just above

/** `[{_id: value, n}]` from a `$group` → counts per known value (unknown values are dropped). */
const tally = <K extends string>(keys: readonly K[], rows: readonly Document[]): Record<K, number> => {
  const out = zeros(keys);
  for (const row of rows) {
    const key: unknown = row['_id'];
    if (typeof key === 'string' && (keys as readonly string[]).includes(key)) out[key as K] = Number(row['n']); // checked
  }
  return out;
};

const onTimeOrLate = (done: Date | undefined, due: Date, now: Date): 'onTime' | 'late' | null =>
  done ? (done.getTime() <= due.getTime() ? 'onTime' : 'late') : now.getTime() > due.getTime() ? 'late' : null;

/**
 * Counts everything a snapshot holds (system scope — the worker). Reads only aggregates; no device or follow is
 * returned, only numbers.
 *
 * @throws StateError FORBIDDEN unless the system.
 */
export async function computeStatsCounts(handle: DbHandle, scope: Scope, now: Date): Promise<StatsCounts> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  const db = await handle.db();
  const group = (collection: string, field: string) =>
    db
      .collection(collection)
      .aggregate([{ $group: { _id: `$${field}`, n: { $sum: 1 } } }])
      .toArray();

  const [masjids, platform, locale, push, follows] = await Promise.all([
    group('masjids', 'status'),
    group('devices', 'platform'),
    group('devices', 'locale'),
    group('devices', 'push_status'),
    db.collection('device_follows').estimatedDocumentCount(),
  ]);
  const devicePlatform = tally(PLATFORM, platform);

  const since24h = new Date(now.getTime() - DAY_MS);
  const [push24] = await db
    .collection('notification_jobs')
    .aggregate([
      { $match: { created_at: { $gte: since24h } } },
      { $group: { _id: null, jobs: { $sum: 1 }, sent: { $sum: '$sent' }, failed: { $sum: '$failed' } } },
    ])
    .toArray();

  const sinceSla = new Date(now.getTime() - SLA_WINDOW_MS);
  const reports = { onTime: 0, late: 0 };
  for await (const doc of db
    .collection<{ sla_due_at: Date; actioned_at?: Date; closed_at?: Date }>('reports')
    .find({ created_at: { $gte: sinceSla } }, { projection: { sla_due_at: 1, actioned_at: 1, closed_at: 1 } })) {
    const result = onTimeOrLate(doc.actioned_at ?? doc.closed_at, doc.sla_due_at, now);
    if (result) reports[result] += 1;
  }
  const grievanceAck = { onTime: 0, late: 0 };
  const grievanceResolve = { onTime: 0, late: 0 };
  for await (const doc of db
    .collection<{ ack_due_at: Date; resolve_due_at: Date; acknowledged_at?: Date; resolved_at?: Date }>('grievances')
    .find(
      { created_at: { $gte: sinceSla } },
      { projection: { ack_due_at: 1, resolve_due_at: 1, acknowledged_at: 1, resolved_at: 1 } },
    )) {
    // Resolved (or rejected) without a separate acknowledgement: the answer is the acknowledgement.
    const ack = onTimeOrLate(doc.acknowledged_at ?? doc.resolved_at, doc.ack_due_at, now);
    if (ack) grievanceAck[ack] += 1;
    const resolve = onTimeOrLate(doc.resolved_at, doc.resolve_due_at, now);
    if (resolve) grievanceResolve[resolve] += 1;
  }

  return {
    masjids: tally(MASJID_STATUS, masjids),
    devices: {
      total: Object.values(devicePlatform).reduce((sum, n) => sum + n, 0),
      platform: devicePlatform,
      locale: tally(LOCALE, locale),
      push: tally(PUSH_STATUS, push),
    },
    follows,
    push24h: {
      jobs: Number(push24?.['jobs'] ?? 0),
      sent: Number(push24?.['sent'] ?? 0),
      failed: Number(push24?.['failed'] ?? 0),
    },
    sla: { reports, grievanceAck, grievanceResolve },
  };
}

/**
 * Recomputes `masjid_stats.ameens_7d` for every masjid (02 §2; feeds the admin "Ameen this week") — one indexed count
 * per masjid (`ameens` `{masjid_id, created_at}`). Only changed values are written.
 *
 * @returns how many masjids changed.
 * @throws StateError FORBIDDEN unless the system.
 */
export async function refreshAmeens7d(handle: DbHandle, scope: Scope, now: Date): Promise<number> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  const db = await handle.db();
  const since = new Date(now.getTime() - AMEEN_WINDOW_MS);
  const stats = db.collection<{ _id: UUID; ameens_7d: number; updated_at: Date }>('masjid_stats');
  let changed = 0;
  for await (const row of stats.find({}, { projection: { ameens_7d: 1 } })) {
    const count = await db.collection('ameens').countDocuments({ masjid_id: row._id, created_at: { $gte: since } });
    if (count === row.ameens_7d) continue;
    await stats.updateOne({ _id: row._id }, { $set: { ameens_7d: count, updated_at: now } });
    changed += 1;
  }
  return changed;
}

/**
 * Writes the hour's snapshot (upsert: a second run in the same hour replaces it — idempotent per hour).
 *
 * @throws StateError FORBIDDEN unless the system.
 */
export async function writeStatsSnapshot(
  handle: DbHandle,
  scope: Scope,
  input: { readonly now: Date; readonly counts: StatsCounts },
): Promise<string> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  const hour = snapshotHour(input.now);
  await (
    await handle.db()
  )
    .collection<{ _id: string; counts: StatsCounts; created_at: Date }>('stats_snapshots')
    .replaceOne({ _id: hour }, { counts: input.counts, created_at: input.now }, { upsert: true });
  return hour;
}

/**
 * The newest snapshot (system — the next run compares Cloudinary usage with it to alert once per threshold).
 *
 * @throws StateError FORBIDDEN unless the system.
 */
export async function latestSnapshotForSystem(handle: DbHandle, scope: Scope): Promise<StatsSnapshot | null> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  const doc = await (
    await handle.db()
  )
    .collection<{ _id: string; counts: StatsCounts; created_at: Date }>('stats_snapshots')
    .findOne({}, { sort: { _id: -1 } });
  return doc ? { hour: doc._id, at: doc.created_at, counts: doc.counts } : null;
}

/**
 * The Stats screen (C12, Super Admin): the newest snapshots, newest first — the first is "now", the rest draw the
 * trends. Read through the policy gateway (`stats_snapshots`: Super Admin find).
 *
 * @param input.limit - how many (1–24 × 30).
 * @throws StateError FORBIDDEN unless the Super Admin.
 */
export async function listStatsSnapshots(
  handle: DbHandle,
  scope: Scope,
  input: { readonly since: Date },
): Promise<readonly StatsSnapshot[]> {
  if (scope.kind !== 'super') throw new StateError('FORBIDDEN');
  const docs = await scoped({ scope, db: await handle.db() }, 'stats_snapshots').find(
    { _id: { $gte: snapshotHour(input.since) } },
    { sort: { _id: -1 }, limit: 24 * 31 },
  );
  return docs.flatMap((doc) => {
    const hour: unknown = doc['_id'];
    const at: unknown = doc['created_at'];
    const counts: unknown = doc['counts'];
    // Written only by writeStatsSnapshot (validator: hour id, date, object) — the shape is ours.
    return typeof hour === 'string' && at instanceof Date && typeof counts === 'object' && counts !== null
      ? [{ hour, at, counts: counts as StatsCounts }]
      : [];
  });
}
