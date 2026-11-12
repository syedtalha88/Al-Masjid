// Bayan videos (DECISIONS #39, 00 §4.3, 02 items.video, PHASE_06 T6.2): a published item that carries only the YouTube
// id, an optional start second, the speaker and our own copy of the thumbnail — never the pasted link. The audience
// (everyone / brothers / sisters) is chosen by the admin, required, and filtered server-side like every item. Edits
// (title, speaker, description) within 24 h; deleting uses the common `deleteItem`.
import { YOUTUBE_ID_PATTERN, YOUTUBE_START_MAX } from '@mc/domain/youtube';
import type { UUID } from 'mongodb';

import { type DbHandle, withTransaction } from '../client.ts';
import { contentWrite, StateError, writeAudit } from '../effects.ts';
import { requireOwnMasjid } from '../repos/admin.ts';
import { numberOf } from '../repos/read.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText } from '../values.ts';
import { EDIT_WINDOW_MS } from './items.ts';
import { enqueueNotification, insertPublishedItem, type ItemAudience } from './publish.ts';

export const VIDEO_TITLE_MAX = 120;
export const VIDEO_SPEAKER_MAX = 80;
export const VIDEO_DESCRIPTION_MAX = 1500;

export interface VideoInput {
  readonly youtubeId: string;
  /** 1..86400 (`parseYouTubeLink`); absent = from the start. */
  readonly startS?: number | undefined;
  readonly title: string;
  readonly speaker?: string | undefined;
  readonly description?: string | undefined;
  /** Required, no default (07 B10). */
  readonly audience: ItemAudience;
  readonly locale: 'en' | 'hi' | 'ur' | 'te';
  /** Our sanitized copy of YouTube's thumbnail (`m/<masjid>/…`, 01 §5.5). */
  readonly thumb: { readonly key: string; readonly thumbhash: string };
  /** The B10 ownership tick (05 §9). */
  readonly rightsConfirmed: true;
}

const audit = (requestId: string | undefined) => (requestId ? { requestId } : {});
const trimmed = (value: string | undefined) => {
  const text = value?.trim() ?? '';
  return text === '' ? undefined : text;
};

function adminOf(scope: Scope, masjidId: UUID): UUID {
  requireOwnMasjid(scope, masjidId);
  if (scope.kind !== 'admin') throw new StateError('FORBIDDEN');
  return scope.adminId;
}

/** The texts of a bayan, checked (VIDEO_INVALID otherwise). */
function texts(input: { title: string; speaker?: string | undefined; description?: string | undefined }) {
  const title = input.title.trim();
  const speaker = trimmed(input.speaker);
  const description = trimmed(input.description);
  const ok =
    title.length >= 1 &&
    title.length <= VIDEO_TITLE_MAX &&
    (speaker === undefined || speaker.length <= VIDEO_SPEAKER_MAX) &&
    (description === undefined || description.length <= VIDEO_DESCRIPTION_MAX);
  if (!ok) throw new StateError('VIDEO_INVALID');
  return { title, speaker, description };
}

/**
 * Publishes a bayan (B10 → Publish) — immediately, with an audience-filtered push when "Notify followers" is on.
 *
 * @returns the item ids and the outbox job (when notifying).
 * @throws StateError MASJID_NOT_FOUND, VIDEO_INVALID (id / start / texts / audience / a thumbnail of another masjid),
 *   NOTIFY_QUOTA_EXCEEDED.
 */
export async function publishVideo(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly masjidId: UUID;
    readonly video: VideoInput;
    readonly notify: boolean;
    readonly requestId?: string | undefined;
    readonly now?: Date | undefined;
  },
): Promise<{ item: { id: string; publicId: string }; notificationJobId: string | null; quotaLeft: number | null }> {
  const adminId = adminOf(scope, input.masjidId);
  const v = input.video;
  const { title, speaker, description } = texts(v);
  const ok =
    YOUTUBE_ID_PATTERN.test(v.youtubeId) &&
    (v.startS === undefined || (Number.isSafeInteger(v.startS) && v.startS >= 1 && v.startS <= YOUTUBE_START_MAX)) &&
    ['everyone', 'brothers', 'sisters'].includes(v.audience) &&
    v.thumb.key.startsWith(`m/${idText(input.masjidId)}/`) &&
    v.rightsConfirmed;
  if (!ok) throw new StateError('VIDEO_INVALID');
  const now = input.now ?? new Date();

  return withTransaction(handle, scope, async (ctx) => {
    const masjid = await scoped(ctx, 'masjids').findOne({ _id: input.masjidId });
    if (!masjid) throw new StateError('MASJID_NOT_FOUND');
    const version = (numberOf(masjid, 'content_version') ?? 0) + 1;
    const result = await contentWrite(ctx, input.masjidId, async (content) => {
      const item = await insertPublishedItem(
        content,
        {
          type: 'video',
          audience: v.audience,
          isImportant: false,
          notify: input.notify,
          title,
          ...(description === undefined ? {} : { body: description }),
          contentLocale: v.locale,
          rightsConfirmed: true,
          detail: {
            video: {
              youtube_id: v.youtubeId,
              ...(v.startS === undefined ? {} : { start_s: v.startS }),
              ...(speaker === undefined ? {} : { speaker }),
              thumb_key: v.thumb.key,
              thumb_thumbhash: v.thumb.thumbhash,
            },
          },
          createdBy: adminId,
          masjidVisible: masjid['status'] === 'active',
          version,
        },
        now,
      );
      if (!input.notify) return { item, jobId: null, quotaLeft: null };
      const limit = numberOf(masjid, 'push_daily_quota') ?? 0;
      const { jobId, used } = await enqueueNotification(
        content,
        { masjidId: input.masjidId, itemId: item.itemId, audience: v.audience, limit },
        now,
      );
      return { item, jobId, quotaLeft: Math.max(0, limit - used) };
    });
    await writeAudit(ctx, {
      action: 'video.publish',
      masjidId: input.masjidId,
      targetType: 'items',
      targetId: idText(result.item.itemId),
      meta: { audience: v.audience, notify: input.notify }, // never the link or the YouTube id's title
      ...audit(input.requestId),
    });
    return {
      item: { id: idText(result.item.itemId), publicId: result.item.publicId },
      notificationJobId: result.jobId ? idText(result.jobId) : null,
      quotaLeft: result.quotaLeft,
    };
  });
}

/**
 * Edits a bayan's title, speaker and description within 24 h of publishing (the video, its thumbnail and the audience
 * stay; edits never re-notify — 00 §4.3).
 *
 * @param input.ifMatch - the item's `updated_at` as last read (ISO 8601).
 * @returns the new `updated_at`.
 * @throws StateError MASJID_NOT_FOUND, VIDEO_INVALID, ITEM_NOT_FOUND (unknown, another masjid's, not a bayan, deleted
 *   or removed), EDIT_WINDOW_CLOSED, PRECONDITION_FAILED.
 */
export async function editVideo(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly masjidId: UUID;
    readonly itemId: UUID;
    readonly ifMatch: string;
    readonly title: string;
    readonly speaker?: string | undefined;
    readonly description?: string | undefined;
    readonly requestId?: string | undefined;
    readonly now?: Date | undefined;
  },
): Promise<{ readonly updatedAt: string }> {
  adminOf(scope, input.masjidId);
  const { title, speaker, description } = texts(input);
  const now = input.now ?? new Date();
  return withTransaction(handle, scope, async (ctx) => {
    const item = await scoped(ctx, 'items').findOne({
      _id: input.itemId,
      masjid_id: input.masjidId,
      type: 'video',
      status: 'published',
    });
    if (!item) throw new StateError('ITEM_NOT_FOUND');
    const publishedAt: unknown = item['published_at'];
    if (!(publishedAt instanceof Date) || now.getTime() - publishedAt.getTime() > EDIT_WINDOW_MS) {
      throw new StateError('EDIT_WINDOW_CLOSED');
    }
    const updatedAt: unknown = item['updated_at'];
    if (!(updatedAt instanceof Date) || updatedAt.toISOString() !== input.ifMatch) {
      throw new StateError('PRECONDITION_FAILED');
    }
    const video = { ...((item['video'] ?? {}) as Record<string, unknown>) }; // by schema
    if (speaker === undefined) delete video['speaker'];
    else video['speaker'] = speaker;
    await contentWrite(ctx, input.masjidId, async (store) => {
      const matched = await scoped(store, 'items').updateOne(
        { _id: input.itemId, status: 'published', updated_at: updatedAt },
        {
          $set: { title, video, edited_at: now, updated_at: now, ...(description ? { body: description } : {}) },
          ...(description ? {} : { $unset: { body: '' } }),
        },
      );
      if (matched !== 1) throw new StateError('PRECONDITION_FAILED');
    });
    await writeAudit(ctx, {
      action: 'item.edit',
      masjidId: input.masjidId,
      targetType: 'items',
      targetId: idText(input.itemId),
      meta: { type: 'video' },
      ...audit(input.requestId),
    });
    return { updatedAt: now.toISOString() };
  });
}
