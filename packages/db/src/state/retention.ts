// Retention (02 §6, PHASE_08 T8.7): the rows of the retention table not already handled elsewhere (posts and needy
// people — item-retention.ts / beneficiary.ts; admin alert subscriptions — admin-push.ts). System scope only (the
// worker's `retention` job, 03:00 IST). Every rule works in batches of ≤ 1,000 documents per operation and loops until
// nothing is left or the time budget ends (the next run carries on — every rule is idempotent). `dryRun` counts what
// would go and changes nothing. Ruqyah recordings and legal-order documents live outside the database: their keys are
// returned for the job to delete first (`listExpiredRuqyahAudio`, `listExpiredLegalOrders`), the documents go after.
import type { ClientSession, Db, UUID } from 'mongodb';

import { type DbHandle, withTransaction } from '../client.ts';
import { StateError, writeAudit } from '../effects.ts';
import type { Scope } from '../scope.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** 02 §6 periods. */
export const RETENTION = {
  inactiveDeviceMs: 180 * DAY_MS,
  deadPushMs: 30 * DAY_MS,
  adminSessionMs: 30 * DAY_MS,
  adminInviteMs: 30 * DAY_MS,
  reportMs: 365 * DAY_MS,
  grievanceMs: 3 * 365 * DAY_MS,
  legalOrderMs: 3 * 365 * DAY_MS,
  auditMs: 2 * 365 * DAY_MS,
  notificationJobMs: 90 * DAY_MS,
  pushQuotaMs: 90 * DAY_MS,
  campaignHistoryMs: 365 * DAY_MS,
  removedAdminMs: 365 * DAY_MS,
  statsMs: 2 * 365 * DAY_MS,
  deletedSectionMs: 30 * DAY_MS,
} as const;

/** Documents per operation (02 §6). */
export const RETENTION_BATCH = 1000;

export interface RetentionOptions {
  readonly now: Date;
  readonly dryRun: boolean;
  /** Stop starting new batches after this instant (wall clock); the next run carries on. */
  readonly deadline: Date;
  /** Batch size (tests use small ones). */
  readonly batch?: number;
}

/** Per-rule counts: deleted (or, in a dry run, due). */
export type RetentionCounts = Record<string, number>;

const requireSystem = (scope: Scope) => {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
};

const before = (now: Date, ms: number) => new Date(now.getTime() - ms);
/** `YYYY-MM-DD` of an instant in IST (calendar dates are IST — CLAUDE.md §6). */
const istDay = (at: Date) => new Date(at.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);

/**
 * Deletes documents of `collection` matching `filter`, `batch` at a time, until none match or the deadline passes.
 * In a dry run, counts them.
 */
async function sweep(
  db: Db,
  collection: string,
  filter: Record<string, unknown>,
  options: RetentionOptions,
): Promise<number> {
  const target = db.collection<{ _id: unknown }>(collection);
  if (options.dryRun) return target.countDocuments(filter);
  const size = options.batch ?? RETENTION_BATCH;
  let total = 0;
  while (Date.now() < options.deadline.getTime()) {
    const ids = (await target.find(filter, { projection: { _id: 1 }, limit: size }).toArray()).map((doc) => doc._id);
    if (ids.length === 0) break;
    total += (await target.deleteMany({ _id: { $in: ids }, ...filter })).deletedCount;
    if (ids.length < size) break;
  }
  return total;
}

/** Same as {@link sweep} for an update (`$unset` / `$set`) instead of a delete. */
async function sweepUpdate(
  db: Db,
  collection: string,
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
  options: RetentionOptions,
): Promise<number> {
  const target = db.collection<{ _id: unknown }>(collection);
  if (options.dryRun) return target.countDocuments(filter);
  const size = options.batch ?? RETENTION_BATCH;
  let total = 0;
  while (Date.now() < options.deadline.getTime()) {
    const ids = (await target.find(filter, { projection: { _id: 1 }, limit: size }).toArray()).map((doc) => doc._id);
    if (ids.length === 0) break;
    total += (await target.updateMany({ _id: { $in: ids }, ...filter }, update)).modifiedCount;
    if (ids.length < size) break;
  }
  return total;
}

/**
 * One device and what hangs off it (02 §5: follows with their follower counts, Ameens — counters keep totals). The
 * device is deleted first, under `still` — the delete itself is the check, so a device used again since it was picked
 * is kept even if that use wrote no `devices` field (#180 L10, re-review N-L7); nothing else changes then.
 */
async function deleteDeviceDocs(
  db: Db,
  session: ClientSession,
  deviceId: UUID,
  still: Record<string, unknown>,
): Promise<boolean> {
  const deleted = await db.collection<{ _id: UUID }>('devices').deleteOne({ _id: deviceId, ...still }, { session });
  if (deleted.deletedCount !== 1) return false;
  const follows = db.collection<{ device_id: UUID; masjid_id: UUID }>('device_follows');
  const followed = await follows.find({ device_id: deviceId }, { session, projection: { masjid_id: 1 } }).toArray();
  for (const follow of followed) {
    await db
      .collection<{ _id: UUID; followers: number; updated_at: Date }>('masjid_stats')
      .updateOne(
        { _id: follow.masjid_id, followers: { $gt: 0 } },
        { $inc: { followers: -1 }, $set: { updated_at: new Date() } },
        { session },
      );
  }
  await follows.deleteMany({ device_id: deviceId }, { session });
  await db.collection<{ device_id: UUID }>('ameens').deleteMany({ device_id: deviceId }, { session });
  return true;
}

/**
 * Every database-only rule of 02 §6 not handled elsewhere. Runs each rule in turn; a rule that hits the deadline stops
 * and the rest still get their (short) turn — they are cheap — so no rule starves.
 *
 * @returns counts per rule (`devices`, `reportDevices`, `deadPush`, `adminSessions`, `adminInvites`, `reports`,
 *   `grievances`, `audit`, `notificationJobs`, `pushQuota`, `campaignHistory`, `removedAdmins`, `stats`, `contacts`).
 * @throws StateError FORBIDDEN outside the system scope.
 */
export async function runRetention(
  handle: DbHandle,
  scope: Scope,
  options: RetentionOptions,
): Promise<RetentionCounts> {
  requireSystem(scope);
  const db = await handle.db();
  const { now } = options;
  const counts: RetentionCounts = {};
  const size = options.batch ?? RETENTION_BATCH;

  // Devices unused for 180 days, with their follows (follower counts down) and Ameens — one transaction each.
  const inactive = { last_seen_at: { $lt: before(now, RETENTION.inactiveDeviceMs) } };
  if (options.dryRun) counts['devices'] = await db.collection('devices').countDocuments(inactive);
  else {
    counts['devices'] = 0;
    while (Date.now() < options.deadline.getTime()) {
      const ids = (
        await db
          .collection<{ _id: UUID }>('devices')
          .find(inactive, { projection: { _id: 1 }, limit: size })
          .toArray()
      ).map((doc) => doc._id);
      for (const id of ids) {
        if (await withTransaction(handle, scope, (ctx) => deleteDeviceDocs(ctx.db, ctx.session, id, inactive))) {
          counts['devices'] += 1;
        }
      }
      if (ids.length < size) break;
    }
  }

  // A deleted device's id leaves its reports (05 §1): devices gone by retention or by "Clear all data".
  const orphanReports = async () =>
    (
      await db
        .collection('reports')
        .aggregate<{ _id: UUID }>([
          { $match: { device_id: { $exists: true } } },
          { $lookup: { from: 'devices', localField: 'device_id', foreignField: '_id', as: 'device' } },
          { $match: { device: { $size: 0 } } },
          { $limit: size },
          { $project: { _id: 1 } },
        ])
        .toArray()
    ).map((doc) => doc._id);
  counts['reportDevices'] = 0;
  while (Date.now() < options.deadline.getTime()) {
    const ids = await orphanReports();
    if (ids.length === 0) break;
    if (options.dryRun) {
      counts['reportDevices'] = ids.length;
      break;
    }
    counts['reportDevices'] += (
      await db.collection<{ _id: UUID }>('reports').updateMany({ _id: { $in: ids } }, { $unset: { device_id: '' } })
    ).modifiedCount;
    if (ids.length < size) break;
  }

  // Dead push subscriptions after 30 days: the address goes, the device stays.
  counts['deadPush'] = await sweepUpdate(
    db,
    'devices',
    { push_status: 'dead', push_updated_at: { $lt: before(now, RETENTION.deadPushMs) } },
    { $unset: { push_endpoint: '', push_p256dh: '', push_auth: '' }, $set: { push_status: 'none' } },
    options,
  );

  // Admin sessions ended 30 days ago (revoked, idle- or absolute-expired); invites used or expired 30 days ago.
  const sessionCut = before(now, RETENTION.adminSessionMs);
  counts['adminSessions'] = await sweep(
    db,
    'admin_sessions',
    {
      $or: [
        { revoked_at: { $lt: sessionCut } },
        { idle_expires_at: { $lt: sessionCut } },
        { absolute_expires_at: { $lt: sessionCut } },
      ],
    },
    options,
  );
  const inviteCut = before(now, RETENTION.adminInviteMs);
  counts['adminInvites'] = await sweep(
    db,
    'admin_invites',
    { $or: [{ used_at: { $lt: inviteCut } }, { expires_at: { $lt: inviteCut } }] },
    options,
  );

  // Reports a year after they were closed; grievances 3 years after resolution.
  counts['reports'] = await sweep(
    db,
    'reports',
    { status: { $ne: 'open' }, closed_at: { $lt: before(now, RETENTION.reportMs) } },
    options,
  );
  counts['grievances'] = await sweep(
    db,
    'grievances',
    { status: { $in: ['resolved', 'rejected'] }, resolved_at: { $lt: before(now, RETENTION.grievanceMs) } },
    options,
  );

  // Audit log 2 years (the run's own summary entry is written by the job after this).
  counts['audit'] = await sweep(db, 'audit_log', { at: { $lt: before(now, RETENTION.auditMs) } }, options);

  // Notification jobs and push quota counters 90 days.
  counts['notificationJobs'] = await sweep(
    db,
    'notification_jobs',
    { created_at: { $lt: before(now, RETENTION.notificationJobMs) } },
    options,
  );
  counts['pushQuota'] = await sweep(
    db,
    'push_quota_usage',
    { day: { $lt: istDay(before(now, RETENTION.pushQuotaMs)) } },
    options,
  );

  // Campaign amount history: a year after the campaign ended (completed / closed; last changed a year ago).
  const endedCampaigns = (
    await db
      .collection<{ _id: UUID }>('items')
      .find(
        {
          type: 'campaign',
          'campaign.status': { $in: ['completed', 'closed'] },
          updated_at: { $lt: before(now, RETENTION.campaignHistoryMs) },
        },
        { projection: { _id: 1 } },
      )
      .toArray()
  ).map((doc) => doc._id);
  counts['campaignHistory'] =
    endedCampaigns.length === 0
      ? 0
      : await sweep(db, 'campaign_amount_history', { campaign_item_id: { $in: endedCampaigns } }, options);

  // Removed admins a year after removal (no masjid left): anonymized — name, phone, passkeys, sessions, alert
  // subscriptions go; the record (and audit references to its id) stays, disabled.
  const removed = await db
    .collection<{ _id: UUID }>('admin_users')
    .find(
      {
        role: 'masjid_admin',
        removed_at: { $lt: before(now, RETENTION.removedAdminMs) },
        display_name: { $ne: REMOVED_ADMIN_NAME },
      },
      { projection: { _id: 1 }, limit: size },
    )
    .toArray();
  counts['removedAdmins'] = 0;
  for (const { _id: adminId } of removed) {
    if (Date.now() >= options.deadline.getTime()) break;
    const stillMember = await db.collection('masjid_admins').countDocuments({ admin_id: adminId }, { limit: 1 });
    if (stillMember > 0) continue;
    counts['removedAdmins'] += 1;
    if (options.dryRun) continue;
    await withTransaction(handle, scope, async (ctx) => {
      const session = { session: ctx.session };
      await ctx.db.collection<{ _id: UUID }>('admin_users').updateOne(
        { _id: adminId },
        {
          $set: { display_name: REMOVED_ADMIN_NAME, status: 'disabled', undertaking_history: [], updated_at: now },
          $unset: { phone_enc: '' },
        },
        session,
      );
      for (const name of ['webauthn_credentials', 'admin_sessions', 'admin_push_subscriptions', 'admin_invites']) {
        await ctx.db.collection<{ admin_id: UUID }>(name).deleteMany({ admin_id: adminId }, session);
      }
    });
  }

  // Audit entries that name a device (follows, audited before security review M2): removed at once — a device's id must
  // not outlive "Clear all data". Devices no longer write the audit log, so after the first run this finds nothing.
  counts['deviceAudit'] = await sweep(db, 'audit_log', { actor_type: 'device' }, options);

  // Stats snapshots 2 years; Ilm contacts deleted 30 days ago (Ruqyah entries go through listExpiredRuqyahAudio).
  counts['stats'] = await sweep(
    db,
    'stats_snapshots',
    { created_at: { $lt: before(now, RETENTION.statsMs) } },
    options,
  );
  counts['contacts'] = await sweep(
    db,
    'masjid_contacts',
    { status: 'deleted', deleted_at: { $lt: before(now, RETENTION.deletedSectionMs) } },
    options,
  );
  return counts;
}

/** What an anonymized admin is called (02 §6). */
export const REMOVED_ADMIN_NAME = 'Removed admin';

/**
 * Ruqyah entries deleted 30 days ago, with the recording each one alone uses (a key still used by a post or another
 * entry is never returned — #165 L1).
 *
 * @throws StateError FORBIDDEN outside the system scope.
 */
export async function listExpiredRuqyah(
  handle: DbHandle,
  scope: Scope,
  input: { readonly now: Date; readonly limit?: number },
): Promise<{ readonly id: UUID; readonly audioKey?: string }[]> {
  requireSystem(scope);
  const db = await handle.db();
  const due = await db
    .collection<{ _id: UUID; audio?: { key?: string } }>('ruqyah_entries')
    .find(
      { status: 'deleted', deleted_at: { $lt: before(input.now, RETENTION.deletedSectionMs) } },
      { projection: { _id: 1, audio: 1 }, limit: input.limit ?? RETENTION_BATCH },
    )
    .toArray();
  const keys = due.flatMap((doc) => (doc.audio?.key ? [doc.audio.key] : []));
  const used = new Set<string>();
  if (keys.length > 0) {
    const dueIds = due.map((doc) => doc._id);
    for (const row of await db
      .collection<{ voice?: { key?: string } }>('items')
      .find({ 'voice.key': { $in: keys } }, { projection: { voice: 1 } })
      .toArray()) {
      if (row.voice?.key) used.add(row.voice.key);
    }
    for (const row of await db
      .collection<{ _id: UUID; audio?: { key?: string } }>('ruqyah_entries')
      .find({ 'audio.key': { $in: keys }, _id: { $nin: dueIds } }, { projection: { audio: 1 } })
      .toArray()) {
      if (row.audio?.key) used.add(row.audio.key);
    }
  }
  const claimed = new Set<string>();
  return due.map((doc) => {
    const key = doc.audio?.key;
    if (!key || used.has(key) || claimed.has(key)) return { id: doc._id };
    claimed.add(key);
    return { id: doc._id, audioKey: key };
  });
}

/**
 * Deletes a Ruqyah entry returned by {@link listExpiredRuqyah} (after its recording is gone).
 *
 * @throws StateError FORBIDDEN outside the system scope.
 */
export async function deleteExpiredRuqyah(handle: DbHandle, scope: Scope, id: UUID): Promise<boolean> {
  requireSystem(scope);
  const removed = await (
    await handle.db()
  )
    .collection<{ _id: UUID }>('ruqyah_entries')
    .deleteOne({ _id: id, status: 'deleted' });
  return removed.deletedCount === 1;
}

/**
 * Legal orders closed 3 years ago, with their (encrypted) document's storage key.
 *
 * @throws StateError FORBIDDEN outside the system scope.
 */
export async function listExpiredLegalOrders(
  handle: DbHandle,
  scope: Scope,
  input: { readonly now: Date; readonly limit?: number },
): Promise<{ readonly id: UUID; readonly documentKey?: string }[]> {
  requireSystem(scope);
  const due = await (
    await handle.db()
  )
    .collection<{ _id: UUID; document_key?: string }>('legal_orders')
    .find(
      { status: 'closed', updated_at: { $lt: before(input.now, RETENTION.legalOrderMs) } },
      { projection: { _id: 1, document_key: 1 }, limit: input.limit ?? RETENTION_BATCH },
    )
    .toArray();
  return due.map((doc) => ({ id: doc._id, ...(doc.document_key ? { documentKey: doc.document_key } : {}) }));
}

/**
 * Deletes a legal order returned by {@link listExpiredLegalOrders} (after its document is gone).
 *
 * @throws StateError FORBIDDEN outside the system scope.
 */
export async function deleteExpiredLegalOrder(handle: DbHandle, scope: Scope, id: UUID): Promise<boolean> {
  requireSystem(scope);
  const removed = await (
    await handle.db()
  )
    .collection<{ _id: UUID }>('legal_orders')
    .deleteOne({ _id: id, status: 'closed' });
  return removed.deletedCount === 1;
}

/**
 * The audited summary of one retention run (02 §6 "audited purge summary"): counts only — never ids.
 *
 * @throws StateError FORBIDDEN outside the system scope.
 */
export async function recordRetentionRun(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly dryRun: boolean;
    readonly counts: RetentionCounts;
    readonly files: number;
    readonly partial: boolean;
  },
): Promise<void> {
  requireSystem(scope);
  await withTransaction(handle, scope, async (ctx) => {
    await writeAudit(ctx, {
      action: 'retention.run',
      targetType: 'retention',
      meta: { dry_run: input.dryRun, counts: input.counts, files: input.files, partial: input.partial },
    });
  });
}
