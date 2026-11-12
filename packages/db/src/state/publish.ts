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

/** What an item says — set at publish, replaced by an edit (T3.9); `detail` is the type's own object (02 §2). */
export interface ItemContent {
  readonly isImportant: boolean;
  readonly title?: string;
  readonly body?: string;
  readonly contentLocale?: 'en' | 'hi' | 'ur' | 'te';
  readonly templateKey?: string;
  readonly templateParams?: Readonly<Record<string, unknown>>;
  /** A photo from `POST /images` and the admin's ownership tick (05 §9). */
  readonly image?: { readonly key: string; readonly thumbhash: string; readonly rightsConfirmed: boolean };
  /** A voice note from `POST /audio` (T3.13); the item then always has a `title`. */
  readonly voice?: VoiceNote;
  /** The ownership tick of content without a photo of its own (a bayan — 05 §9, PHASE_06 T6.2). */
  readonly rightsConfirmed?: boolean;
  readonly detail:
    | { readonly announcement: Readonly<Record<string, unknown>> }
    | { readonly daily: Readonly<Record<string, unknown>> }
    | { readonly dua: Readonly<Record<string, unknown>> }
    | { readonly campaign: Readonly<Record<string, unknown>> }
    | { readonly chanda: Readonly<Record<string, unknown>> }
    | { readonly video: Readonly<Record<string, unknown>> };
}

/** A voice note as a post carries it (02 items.voice). */
export interface VoiceNote {
  readonly key: string;
  readonly durationS: number;
  readonly peaks: readonly number[];
}

/** A voice note, with the post's title (required with one), on top of a type's content. */
export interface VoiceInput {
  readonly voice?: VoiceNote | undefined;
  /** The post's title: required with a voice note when the content has no title of its own. */
  readonly title?: string | undefined;
}

/**
 * The voice note and title part of a post's content, checked: the recording is the masjid's own (`m/<masjid>/a/…`) and
 * the post then has a title (its own text's, or `input.title`).
 *
 * @param ownTitle - the title the content already has (a free-text notice), if any.
 * @throws StateError VOICE_INVALID.
 */
export function voiceContent(
  masjidId: string,
  input: VoiceInput,
  ownTitle?: string,
): { readonly voice?: VoiceNote; readonly title?: string } {
  const title = ownTitle ?? input.title;
  if (!input.voice) return {}; // a title comes with a voice note only (the contract refuses it alone)
  if (!input.voice.key.startsWith(`m/${masjidId}/a/`) || title === undefined) throw new StateError('VOICE_INVALID');
  return { voice: input.voice, ...(ownTitle === undefined ? { title } : {}) };
}

/** The common fields of a published item. */
export interface PublishedItemInput extends ItemContent {
  readonly type:
    'announcement' | 'timing_update' | 'daily_content' | 'dua_request' | 'campaign' | 'chanda_update' | 'video';
  readonly audience: ItemAudience;
  readonly notify: boolean;
}

/** The optional content fields: an edit `$unset`s those its new content no longer has. */
export const OPTIONAL_CONTENT_FIELDS = [
  'title',
  'body',
  'content_locale',
  'template_key',
  'template_params',
  'image_key',
  'image_thumbhash',
  'rights_confirmed',
  'voice',
] as const;

/** The item document fields of `content` (snake_case, absent optionals left out). */
export function contentDocument(content: ItemContent): Record<string, unknown> {
  return {
    ...(content.title === undefined ? {} : { title: content.title }),
    ...(content.body === undefined ? {} : { body: content.body }),
    ...(content.contentLocale === undefined ? {} : { content_locale: content.contentLocale }),
    ...(content.templateKey === undefined ? {} : { template_key: content.templateKey }),
    ...(content.templateParams === undefined ? {} : { template_params: { ...content.templateParams } }),
    is_important: content.isImportant,
    ...(content.rightsConfirmed === undefined ? {} : { rights_confirmed: content.rightsConfirmed }),
    ...(content.image === undefined
      ? {}
      : {
          image_key: content.image.key,
          image_thumbhash: content.image.thumbhash,
          rights_confirmed: content.image.rightsConfirmed,
        }),
    ...(content.voice === undefined
      ? {}
      : {
          voice: {
            key: content.voice.key,
            duration_s: content.voice.durationS,
            peaks: [...content.voice.peaks],
          },
        }),
    ...content.detail,
  };
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
    ...contentDocument(input),
    notify: input.notify,
    masjid_visible: input.masjidVisible,
    published_at: now,
    published_version: Long.fromNumber(input.version),
    created_by: input.createdBy,
    created_at: now,
    updated_at: now,
  });
  return { itemId, publicId };
}

/**
 * Counts one notification against today's quota (IST day) and writes the pending outbox job for `itemId`.
 *
 * @param limit - the masjid's `push_daily_quota`.
 * @returns the job's `_id` and today's count including this notification.
 * @throws StateError NOTIFY_QUOTA_EXCEEDED when today's notifications are used up (nothing is written; the admin may
 *   publish without notifying — Phase 4 asks first).
 */
export async function enqueueNotification(
  ctx: TxContext,
  input: { readonly masjidId: UUID; readonly itemId: UUID; readonly audience: ItemAudience; readonly limit: number },
  now: Date,
): Promise<{ jobId: UUID; used: number }> {
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
  return { jobId, used: used + 1 };
}

/**
 * Publishes a `timing_update` item (a system template, shown to everyone) and its pending outbox job, inside the
 * caller's `contentWrite()` — the "Notify followers" step of saving timings (T3.2) and special dates (T3.3).
 *
 * @param input.version - the masjid's `content_version` after this transaction's bump.
 * @param input.limit - the masjid's `push_daily_quota`.
 * @returns the item's public id and its pending outbox job.
 * @throws StateError NOTIFY_QUOTA_EXCEEDED (the whole save rolls back).
 */
export async function publishTimingUpdate(
  content: ContentContext,
  input: {
    readonly templateKey: string;
    readonly templateParams: Readonly<Record<string, unknown>>;
    readonly createdBy: UUID;
    readonly masjidVisible: boolean;
    readonly version: number;
    readonly limit: number;
  },
  now: Date,
): Promise<{ publicId: string; jobId: UUID }> {
  const item = await insertPublishedItem(
    content,
    {
      type: 'timing_update',
      audience: 'everyone',
      isImportant: false,
      notify: true,
      templateKey: input.templateKey,
      templateParams: input.templateParams,
      detail: { announcement: { category: 'timing' } },
      createdBy: input.createdBy,
      masjidVisible: input.masjidVisible,
      version: input.version,
    },
    now,
  );
  const { jobId } = await enqueueNotification(
    content,
    { masjidId: content.contentMasjidId, itemId: item.itemId, audience: 'everyone', limit: input.limit },
    now,
  );
  return { publicId: item.publicId, jobId };
}
