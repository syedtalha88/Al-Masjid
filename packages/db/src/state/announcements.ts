// Publishing a notice (00 §4.3 Announcements, 03 §4 `POST /items/announcement`, 07 B5, PHASE_03 T3.6): a template with
// its params (checked against the template's declared params) or the admin's own title + body, an optional photo of
// the admin's own masjid, the version bump, the audit entry and — with "Notify followers" — the quota count and the
// pending outbox job. One transaction.
import { templateValueProblems } from '@mc/i18n/template-args';
import type { Document, UUID } from 'mongodb';

import { type DbHandle, type TxContext, withTransaction } from '../client.ts';
import { contentWrite, StateError, writeAudit } from '../effects.ts';
import { requireOwnMasjid } from '../repos/admin.ts';
import { arrayOf, need, numberOf, oneOf } from '../repos/read.ts';
import { TEMPLATE_PARAM_TYPE } from '../schema/enums.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText } from '../values.ts';
import {
  enqueueNotification,
  insertPublishedItem,
  type ItemContent,
  voiceContent,
  type VoiceInput,
} from './publish.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** An event may be at most this far ahead (as special dates — 00 §4.2), and not more than a day in the past. */
const EVENT_AHEAD_DAYS = 400;

/** A notice as the admin publishes it (the contracts checked shapes and lengths). */
export interface AnnouncementInput extends VoiceInput {
  readonly content:
    | {
        readonly kind: 'template';
        readonly key: string;
        readonly params: Readonly<Record<string, string | number | { readonly start: string; readonly end: string }>>;
      }
    | {
        readonly kind: 'text';
        readonly title: string;
        readonly body: string;
        readonly locale: 'en' | 'hi' | 'ur' | 'te';
      };
  readonly category: 'general' | 'event' | 'facilities' | 'timing';
  readonly isImportant: boolean;
  readonly eventAt?: Date | undefined;
  /** From `POST /images` of the same masjid; `rightsConfirmed` is the B5 ownership tick. */
  readonly image?: { readonly key: string; readonly thumbhash: string; readonly rightsConfirmed: true } | undefined;
  readonly notify: boolean;
}

export interface AnnouncementPublished {
  readonly item: { readonly id: string; readonly publicId: string };
  /** Notifications left today after this publish; `null` when it did not notify. */
  readonly quotaLeft: number | null;
  /** The pending outbox job to hand to the worker after commit (01 §5.3 step 1); `null` when it did not notify. */
  readonly notificationJobId: string | null;
}

/** The template's declared params, read from an admin-visible (active, not system) template. */
const paramsOf = (template: Document) =>
  arrayOf(template, 'params').map((param) => ({
    name: need(param, 'name'),
    type: oneOf(param, 'type', TEMPLATE_PARAM_TYPE),
    required: param['required'] === true,
  }));

/**
 * A notice's content, checked as at publish: a photo of the masjid's own, an event time from a day ago to 400 days
 * ahead, a template an admin may pick (read in the caller's transaction) with params that fit it. Shared by publishing
 * and editing (T3.9).
 *
 * @throws StateError ANNOUNCEMENT_INVALID, TEMPLATE_NOT_FOUND, VOICE_INVALID (another masjid's recording, a voice
 *   note without a title).
 */
export async function announcementContent(
  ctx: TxContext,
  masjidId: UUID,
  announcement: Omit<AnnouncementInput, 'notify'>,
  now: Date,
): Promise<ItemContent> {
  const { content, image, eventAt } = announcement;
  if (image && !image.key.startsWith(`m/${idText(masjidId)}/`)) throw new StateError('ANNOUNCEMENT_INVALID');
  if (
    eventAt &&
    (eventAt.getTime() < now.getTime() - DAY_MS || eventAt.getTime() > now.getTime() + EVENT_AHEAD_DAYS * DAY_MS)
  ) {
    throw new StateError('ANNOUNCEMENT_INVALID');
  }
  if (content.kind === 'template') {
    const template = await scoped(ctx, 'notice_templates').findOne({ _id: content.key });
    if (!template) throw new StateError('TEMPLATE_NOT_FOUND');
    if (templateValueProblems(content.params, paramsOf(template)).length > 0) {
      throw new StateError('ANNOUNCEMENT_INVALID');
    }
  }
  const voice = voiceContent(idText(masjidId), announcement, content.kind === 'text' ? content.title : undefined);
  return {
    isImportant: announcement.isImportant,
    ...(content.kind === 'template'
      ? { templateKey: content.key, templateParams: content.params }
      : { title: content.title, body: content.body, contentLocale: content.locale }),
    ...voice,
    ...(image ? { image } : {}),
    detail: { announcement: { category: announcement.category, ...(eventAt ? { event_at: eventAt } : {}) } },
  };
}

/**
 * Publishes a notice for one of the admin's masjids.
 *
 * @returns the item's ids and, when notifying, the notifications left today.
 * @throws StateError MASJID_NOT_FOUND (outside the scope), TEMPLATE_NOT_FOUND (unknown, draft, retired or system
 *   template), ANNOUNCEMENT_INVALID (params that do not fit the template, a photo of another masjid, an event time
 *   more than a day ago or over 400 days ahead), NOTIFY_QUOTA_EXCEEDED (nothing is published).
 */
export async function publishAnnouncement(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly masjidId: UUID;
    readonly announcement: AnnouncementInput;
    readonly requestId?: string | undefined;
    readonly now?: Date | undefined;
  },
): Promise<AnnouncementPublished> {
  requireOwnMasjid(scope, input.masjidId);
  if (scope.kind !== 'admin') throw new StateError('FORBIDDEN');
  const adminId = scope.adminId;
  const now = input.now ?? new Date();
  const { content, image, notify } = input.announcement;

  return withTransaction(handle, scope, async (ctx) => {
    const masjid = await scoped(ctx, 'masjids').findOne({ _id: input.masjidId });
    if (!masjid) throw new StateError('MASJID_NOT_FOUND');
    const itemContent = await announcementContent(ctx, input.masjidId, input.announcement, now);
    const version = (numberOf(masjid, 'content_version') ?? 0) + 1;

    const published = await contentWrite(ctx, input.masjidId, async (store) => {
      const item = await insertPublishedItem(
        store,
        {
          type: 'announcement',
          audience: 'everyone',
          notify,
          ...itemContent,
          createdBy: adminId,
          masjidVisible: masjid['status'] === 'active',
          version,
        },
        now,
      );
      if (!notify) return { item, quotaLeft: null, jobId: null };
      const limit = numberOf(masjid, 'push_daily_quota') ?? 0;
      const { jobId, used } = await enqueueNotification(
        store,
        { masjidId: input.masjidId, itemId: item.itemId, audience: 'everyone', limit },
        now,
      );
      return { item, quotaLeft: Math.max(0, limit - used), jobId };
    });
    await writeAudit(ctx, {
      action: 'item.publish',
      masjidId: input.masjidId,
      targetType: 'items',
      targetId: idText(published.item.itemId),
      meta: {
        type: 'announcement',
        template: content.kind === 'template' ? content.key : null,
        notify,
        image: image !== undefined,
      },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return {
      item: { id: idText(published.item.itemId), publicId: published.item.publicId },
      quotaLeft: published.quotaLeft,
      notificationJobId: published.jobId ? idText(published.jobId) : null,
    };
  });
}
