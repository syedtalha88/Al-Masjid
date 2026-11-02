// Publishing a feed item (02 §2 items, §5; DECISIONS #9): the item and — when the admin notifies followers — the push
// quota increment and the `notification_jobs` outbox document, all in the caller's transaction. Sending is Phase 4: the
// worker picks pending jobs up (and the outbox sweeper re-enqueues any the API did not hand over after commit).
import { calendarDateInZone } from '@mc/domain/time';
import { Long, type UUID } from 'mongodb';

import type { TxContext } from '../client.ts';
import { type ContentContext, StateError } from '../effects.ts';
import { quotaUsageId } from '../repos/admin.ts';
import { numberOf } from '../repos/read.ts';
import { scoped } from '../scoped.ts';
import { newId, newPublicId } from '../values.ts';

export type ItemAudience = 'everyone' | 'brothers' | 'sisters';

/** The common fields of a published item; `detail` is the type's own object (02 §2 `ITEM_DETAIL`). */
export interface PublishedItemInput {
  readonly type: 'announcement' | 'timing_update' | 'daily_content' | 'dua_request';
  readonly audience: ItemAudience;
  readonly isImportant: boolean;
  readonly notify: boolean;
  readonly title?: string;
  readonly body?: string;
  readonly contentLocale?: 'en' | 'hi' | 'ur' | 'te';
  readonly templateKey?: string;
  readonly templateParams?: Readonly<Record<string, unknown>>;
  readonly detail:
    | { readonly announcement: Readonly<Record<string, unknown>> }
    | { readonly daily: Readonly<Record<string, unknown>> }
    | { readonly dua: Readonly<Record<string, unknown>> };
}

/**
 * Inserts a published item through the policy gateway, inside `contentWrite()` (the caller's).
 *
 * @param version - the masjid's `content_version` after this transaction's bump (`published_version`).
 * @returns the new item's `_id` and `public_id`.
 */
export async function insertPublishedItem(
  content: ContentContext,
  input: PublishedItemInput & { readonly createdBy: UUID; readonly masjidVisible: boolean; readonly version: number },
  now: Date,
): Promise<{ itemId: UUID; publicId: string }> {
  const itemId = newId();
  const publicId = newPublicId();
  await scoped(content, 'items').insertOne({
    _id: itemId,
    public_id: publicId,
    masjid_id: content.contentMasjidId,
    type: input.type,
    status: 'published',
    audience: input.audience,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(input.contentLocale === undefined ? {} : { content_locale: input.contentLocale }),
    ...(input.templateKey === undefined ? {} : { template_key: input.templateKey }),
    ...(input.templateParams === undefined ? {} : { template_params: { ...input.templateParams } }),
    is_important: input.isImportant,
    notify: input.notify,
    masjid_visible: input.masjidVisible,
    published_at: now,
    published_version: Long.fromNumber(input.version),
    created_by: input.createdBy,
    ...input.detail,
    created_at: now,
    updated_at: now,
  });
  return { itemId, publicId };
}

/**
 * Counts one notification against today's quota (IST day) and writes the pending outbox job for `itemId`.
 *
 * @param limit - the masjid's `push_daily_quota`.
 * @returns the job's `_id`.
 * @throws StateError NOTIFY_QUOTA_EXCEEDED when today's notifications are used up (nothing is written; the admin may
 *   publish without notifying — Phase 4 asks first).
 */
export async function enqueueNotification(
  ctx: TxContext,
  input: { readonly masjidId: UUID; readonly itemId: UUID; readonly audience: ItemAudience; readonly limit: number },
  now: Date,
): Promise<UUID> {
  const day = calendarDateInZone(now);
  const id = quotaUsageId(input.masjidId, day);
  const usage = scoped(ctx, 'push_quota_usage');
  const current = await usage.findOne({ _id: id });
  const used = (current && numberOf(current, 'count')) ?? 0;
  if (used >= input.limit) throw new StateError('NOTIFY_QUOTA_EXCEEDED');
  if (current) {
    // Conditional: a concurrent publish that took the last notification makes this one fail (02 push_quota_usage).
    const matched = await usage.updateOne({ _id: id, count: { $lt: input.limit } }, { $inc: { count: 1 } });
    if (matched !== 1) throw new StateError('NOTIFY_QUOTA_EXCEEDED');
  } else {
    await usage.insertOne({ _id: id, masjid_id: input.masjidId, day, count: 1 });
  }
  const jobId = newId();
  await scoped(ctx, 'notification_jobs').insertOne({
    _id: jobId,
    item_id: input.itemId,
    masjid_id: input.masjidId,
    status: 'pending',
    audience: input.audience,
    audience_targets: input.audience === 'everyone' ? ['brothers', 'sisters'] : [input.audience],
    targeted: 0,
    sent: 0,
    failed: 0,
    pruned: 0,
    pending_batches: 0,
    bypass_quota: false,
    created_at: now,
  });
  return jobId;
}
