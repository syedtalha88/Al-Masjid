// Publishing today's hadith / ayah (00 §4.3 Daily, 03 §4 `POST /items/daily-content`, 07 B6, PHASE_03 T3.7): a verified
// Content Library entry — never free text (no misattribution) — with the masjid's optional short note, the version
// bump, the audit entry and — with "Notify followers" — the quota count and the pending outbox job. One transaction.
import type { UUID } from 'mongodb';

import { type DbHandle, type TxContext, withTransaction } from '../client.ts';
import { contentWrite, StateError, writeAudit } from '../effects.ts';
import { requireOwnMasjid } from '../repos/admin.ts';
import { numberOf } from '../repos/read.ts';
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

/** Today's hadith / ayah as the admin publishes it (the contract checked the note's length and characters). */
export interface DailyContentInput extends VoiceInput {
  readonly libraryId: UUID;
  readonly note?: string | undefined;
  readonly notify: boolean;
}

export interface DailyContentPublished {
  readonly item: { readonly id: string; readonly publicId: string };
  readonly kind: 'hadith' | 'ayah';
  /** Notifications left today after this publish; `null` when it did not notify. */
  readonly quotaLeft: number | null;
  /** The pending outbox job to hand to the worker after commit (01 §5.3 step 1); `null` when it did not notify. */
  readonly notificationJobId: string | null;
}

/**
 * Today's hadith / ayah content: a verified hadith or ayah (read through the admin cell in the caller's transaction) and
 * the note. Shared by publishing and editing (T3.9).
 *
 * @throws StateError LIBRARY_ENTRY_NOT_FOUND (unknown, draft or retired entry, or not a hadith / ayah), VOICE_INVALID.
 */
export async function dailyContent(
  ctx: TxContext,
  daily: Omit<DailyContentInput, 'notify'>,
  masjidId: UUID,
): Promise<{ content: ItemContent; kind: 'hadith' | 'ayah' }> {
  // The admin cell reads verified entries only.
  const entry = await scoped(ctx, 'content_library').findOne({
    _id: daily.libraryId,
    kind: { $in: ['hadith', 'ayah'] },
  });
  const kind: unknown = entry?.['kind'];
  if (kind !== 'hadith' && kind !== 'ayah') throw new StateError('LIBRARY_ENTRY_NOT_FOUND');
  const { libraryId, note } = daily;
  return {
    kind,
    content: {
      isImportant: false,
      ...voiceContent(idText(masjidId), daily),
      detail: { daily: { library_id: libraryId, kind, ...(note === undefined ? {} : { note }) } },
    },
  };
}

/**
 * Publishes a verified hadith or ayah as one of the admin's masjids' daily content. A second one of the same kind on
 * the same day is allowed — the admin is warned beforehand (B6), not refused.
 *
 * @returns the item's ids, the entry's kind and, when notifying, the notifications left today.
 * @throws StateError MASJID_NOT_FOUND (outside the scope), LIBRARY_ENTRY_NOT_FOUND (unknown, draft or retired entry, or
 *   a dua / dhikr — only hadith and ayah are daily content), NOTIFY_QUOTA_EXCEEDED (nothing is published).
 */
export async function publishDailyContent(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly masjidId: UUID;
    readonly daily: DailyContentInput;
    readonly requestId?: string | undefined;
    readonly now?: Date | undefined;
  },
): Promise<DailyContentPublished> {
  requireOwnMasjid(scope, input.masjidId);
  if (scope.kind !== 'admin') throw new StateError('FORBIDDEN');
  const adminId = scope.adminId;
  const now = input.now ?? new Date();
  const { notify } = input.daily;

  return withTransaction(handle, scope, async (ctx) => {
    const masjid = await scoped(ctx, 'masjids').findOne({ _id: input.masjidId });
    if (!masjid) throw new StateError('MASJID_NOT_FOUND');
    const { content, kind } = await dailyContent(ctx, input.daily, input.masjidId);
    const version = (numberOf(masjid, 'content_version') ?? 0) + 1;

    const published = await contentWrite(ctx, input.masjidId, async (store) => {
      const item = await insertPublishedItem(
        store,
        {
          type: 'daily_content',
          audience: 'everyone',
          notify,
          ...content,
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
      meta: { type: 'daily_content', template: null, notify, image: false },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return {
      item: { id: idText(published.item.itemId), publicId: published.item.publicId },
      kind,
      quotaLeft: published.quotaLeft,
      notificationJobId: published.jobId ? idText(published.jobId) : null,
    };
  });
}
