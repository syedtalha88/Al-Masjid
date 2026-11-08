// Admin notification visibility (PHASE_04 T4.5, 03 §4 Notifications, 07 B3 / B5): today's quota with how many
// followers each audience reaches (the Publish bar's "Will notify N people") and whether the Super Admin paused push
// (T4.7), the masjid's notification history with sent / failed counts, and the Super Admin's push success rate (C1).
import { addDays, calendarDateInZone, istInstant } from '@mc/domain/time';
import type { Document, UUID } from 'mongodb';

import type { DbHandle } from '../client.ts';
import { StateError } from '../effects.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText } from '../values.ts';
import { quotaUsageId, requireOwnMasjid } from './admin.ts';
import { decodeCursor } from './public.ts';
import { numberOf, objectOf, oneOf, text } from './read.ts';

const JOB_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;
const AUDIENCES = ['everyone', 'brothers', 'sisters'] as const;
const ITEM_TYPES = [
  'announcement',
  'daily_content',
  'dua_request',
  'campaign',
  'chanda_update',
  'video',
  'timing_update',
] as const;
/** Jobs per history page. */
export const NOTIFICATION_PAGE_SIZE = 30;

export interface PushQuotaView {
  readonly used: number;
  readonly limit: number;
  readonly resetsAt: Date;
  /** The Super Admin's kill switch is on: publishing still works, notifications wait (T4.7). */
  readonly paused: boolean;
  /** Followers a notification reaches now, per item audience (not muted, notifications on). */
  readonly reach: { readonly everyone: number; readonly brothers: number; readonly sisters: number };
}

/**
 * Today's push quota (03 §4 `GET /notifications/quota`, 02 `push_quota_usage`) — notifying publishes count against
 * the masjid's `push_daily_quota` per IST day and the count resets at the next midnight in India — with the audience
 * reach (through `v_admin_follow_audience`, no device ids) and the kill switch.
 *
 * @throws StateError MASJID_NOT_FOUND for a masjid outside the admin's scope.
 */
export async function getNotificationStatus(
  handle: DbHandle,
  scope: Scope,
  masjidId: UUID,
  now: Date,
): Promise<PushQuotaView> {
  requireOwnMasjid(scope, masjidId);
  const db = await handle.db();
  const masjid = await scoped({ scope, db }, 'masjids').findOne({ _id: masjidId });
  if (!masjid) throw new StateError('MASJID_NOT_FOUND');
  const today = calendarDateInZone(now);
  const audience = scoped({ scope, db }, 'v_admin_follow_audience');
  const reachOf = (prefs: readonly string[]) =>
    audience.count({ masjid_id: masjidId, muted: false, push_active: true, audience_pref: { $in: [...prefs] } });
  const [usage, settings, brothers, sisters] = await Promise.all([
    scoped({ scope, db }, 'push_quota_usage').findOne({ _id: quotaUsageId(masjidId, today) }),
    scoped({ scope, db }, 'app_settings').findOne({ _id: 'global' }),
    reachOf(['brothers']),
    reachOf(['sisters']),
  ]);
  return {
    used: (usage && numberOf(usage, 'count')) ?? 0,
    limit: numberOf(masjid, 'push_daily_quota') ?? 0,
    resetsAt: istInstant(addDays(today, 1), '00:00'),
    paused: settings?.['push_paused'] === true,
    reach: { everyone: brothers + sisters, brothers, sisters },
  };
}

/** One notification in the masjid's history (B3 → Notifications). */
export interface NotificationJobRow {
  readonly id: string;
  readonly status: (typeof JOB_STATUSES)[number];
  readonly audience: (typeof AUDIENCES)[number];
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly targeted: number;
  readonly sent: number;
  readonly failed: number;
  readonly pruned: number;
  /** The post it announced; absent once the post was purged (180 days after deletion). */
  readonly item?: {
    readonly id: string;
    readonly type: (typeof ITEM_TYPES)[number];
    readonly category?: string;
    readonly title?: string;
    readonly templateKey?: string;
    readonly status: string;
  };
}

const cursorOf = (doc: Document): string => {
  const at = doc['created_at'] as Date; // validated: instant
  return Buffer.from(JSON.stringify([at.getTime(), (doc['_id'] as UUID).toHexString(false)])).toString('base64url');
};

/**
 * The masjid's notifications, newest first, 30 a page.
 *
 * @throws StateError MASJID_NOT_FOUND for a masjid outside the admin's scope.
 */
export async function listNotificationJobs(
  handle: DbHandle,
  scope: Scope,
  masjidId: UUID,
  input: { readonly cursor?: string | undefined } = {},
): Promise<{ rows: NotificationJobRow[]; next: string | null }> {
  requireOwnMasjid(scope, masjidId);
  const db = await handle.db();
  const after = input.cursor ? decodeCursor(input.cursor) : undefined;
  const docs = await scoped({ scope, db }, 'notification_jobs').find(
    {
      masjid_id: masjidId,
      ...(after
        ? { created_at: { $lte: after.at }, $or: [{ created_at: { $lt: after.at } }, { _id: { $lt: after.id } }] }
        : {}),
    },
    { sort: { created_at: -1, _id: -1 }, limit: NOTIFICATION_PAGE_SIZE + 1 },
  );
  const page = docs.slice(0, NOTIFICATION_PAGE_SIZE);
  const items = new Map<string, Document>();
  if (page.length > 0) {
    const ids = page.map((doc) => doc['item_id'] as UUID);
    for (const item of await scoped({ scope, db }, 'items').find({ _id: { $in: ids } }))
      items.set(idText(item['_id'] as UUID), item);
  }
  const rows = page.map((doc): NotificationJobRow => {
    const item = items.get(idText(doc['item_id'] as UUID));
    const detail = item && (objectOf(item, 'announcement') ?? objectOf(item, 'daily') ?? objectOf(item, 'dua'));
    const category = detail ? (text(detail, 'category') ?? text(detail, 'kind')) : undefined;
    const completed: unknown = doc['completed_at'];
    const title = item ? text(item, 'title') : undefined;
    const templateKey = item ? text(item, 'template_key') : undefined;
    return {
      id: idText(doc['_id'] as UUID),
      status: oneOf(doc, 'status', JOB_STATUSES),
      audience: oneOf(doc, 'audience', AUDIENCES),
      createdAt: (doc['created_at'] as Date).toISOString(),
      ...(completed instanceof Date ? { completedAt: completed.toISOString() } : {}),
      targeted: numberOf(doc, 'targeted') ?? 0,
      sent: numberOf(doc, 'sent') ?? 0,
      failed: numberOf(doc, 'failed') ?? 0,
      pruned: numberOf(doc, 'pruned') ?? 0,
      ...(item
        ? {
            item: {
              id: idText(item['_id'] as UUID),
              type: oneOf(item, 'type', ITEM_TYPES),
              status: text(item, 'status') ?? 'published',
              ...(category === undefined ? {} : { category }),
              ...(title === undefined ? {} : { title }),
              ...(templateKey === undefined ? {} : { templateKey }),
            },
          }
        : {}),
    };
  });
  const last = page.at(-1);
  return { rows, next: docs.length > NOTIFICATION_PAGE_SIZE && last ? cursorOf(last) : null };
}

/** Push delivery over the last 24 hours (C1 Stats "push success 24h"). */
export interface PushStats {
  readonly jobs: number;
  readonly running: number;
  readonly failedJobs: number;
  readonly sent: number;
  readonly failed: number;
  readonly pruned: number;
  /** sent / (sent + failed), `null` before anything was sent. */
  readonly successRate: number | null;
  readonly paused: boolean;
}

/**
 * Push delivery of every masjid since `since`.
 *
 * @throws StateError FORBIDDEN (not the Super Admin).
 */
export async function getPushStats(handle: DbHandle, scope: Scope, since: Date): Promise<PushStats> {
  if (scope.kind !== 'super') throw new StateError('FORBIDDEN');
  const db = await handle.db();
  const docs = await scoped({ scope, db }, 'notification_jobs').find({ created_at: { $gte: since } }, { limit: 5000 });
  let sent = 0;
  let failed = 0;
  let pruned = 0;
  let running = 0;
  let failedJobs = 0;
  for (const doc of docs) {
    sent += numberOf(doc, 'sent') ?? 0;
    failed += numberOf(doc, 'failed') ?? 0;
    pruned += numberOf(doc, 'pruned') ?? 0;
    if (doc['status'] === 'running' || doc['status'] === 'pending') running += 1;
    if (doc['status'] === 'failed') failedJobs += 1;
  }
  const settings = await scoped({ scope, db }, 'app_settings').findOne({ _id: 'global' });
  return {
    jobs: docs.length,
    running,
    failedJobs,
    sent,
    failed,
    pruned,
    successRate: sent + failed === 0 ? null : sent / (sent + failed),
    paused: settings?.['push_paused'] === true,
  };
}
