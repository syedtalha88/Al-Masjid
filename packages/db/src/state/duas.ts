// Publishing a dua request (00 §4.3 Dua requests, 03 §4 `POST /items/dua`, 07 B7, PHASE_03 T3.8): the category, the
// admin's message in its language, the person's name (kept from musallis by `v_pub_items` while `name_private` is on —
// 02 §4.2), a verified dua of the Content Library, an inteqal's janaza time and place; the version bump, the audit entry
// (never the name) and — with "Notify followers" — the quota count and the pending outbox job. One transaction.
import type { UUID } from 'mongodb';

import { type DbHandle, withTransaction } from '../client.ts';
import { contentWrite, StateError, writeAudit } from '../effects.ts';
import { requireOwnMasjid } from '../repos/admin.ts';
import { numberOf } from '../repos/read.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText } from '../values.ts';
import { enqueueNotification, insertPublishedItem } from './publish.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A janaza is announced at most this far ahead, and not more than a day after it was held. */
const JANAZA_AHEAD_DAYS = 30;

/** A dua request as the admin publishes it (the contract checked lengths, characters and inteqal-only fields). */
export interface DuaRequestInput {
  readonly category: 'illness' | 'inteqal' | 'other';
  readonly message: string;
  readonly locale: 'en' | 'hi' | 'ur' | 'te';
  readonly personName?: string | undefined;
  readonly namePrivate: boolean;
  readonly libraryId: UUID;
  readonly janazaAt?: Date | undefined;
  readonly janazaPlace?: string | undefined;
  readonly notify: boolean;
}

export interface DuaRequestPublished {
  readonly item: { readonly id: string; readonly publicId: string };
  /** Notifications left today after this publish; `null` when it did not notify. */
  readonly quotaLeft: number | null;
}

/**
 * Publishes a dua request for one of the admin's masjids.
 *
 * @returns the item's ids and, when notifying, the notifications left today.
 * @throws StateError MASJID_NOT_FOUND (outside the scope), LIBRARY_ENTRY_NOT_FOUND (unknown, draft or retired entry, or
 *   not a dua), DUA_INVALID (a janaza on another category, or its time more than a day ago or over 30 days ahead),
 *   NOTIFY_QUOTA_EXCEEDED (nothing is published).
 */
export async function publishDuaRequest(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly masjidId: UUID;
    readonly dua: DuaRequestInput;
    readonly requestId?: string | undefined;
    readonly now?: Date | undefined;
  },
): Promise<DuaRequestPublished> {
  requireOwnMasjid(scope, input.masjidId);
  if (scope.kind !== 'admin') throw new StateError('FORBIDDEN');
  const adminId = scope.adminId;
  const now = input.now ?? new Date();
  const { dua } = input;
  if ((dua.janazaAt !== undefined || dua.janazaPlace !== undefined) && dua.category !== 'inteqal') {
    throw new StateError('DUA_INVALID');
  }
  if (
    dua.janazaAt &&
    (dua.janazaAt.getTime() < now.getTime() - DAY_MS ||
      dua.janazaAt.getTime() > now.getTime() + JANAZA_AHEAD_DAYS * DAY_MS)
  ) {
    throw new StateError('DUA_INVALID');
  }

  return withTransaction(handle, scope, async (ctx) => {
    const masjid = await scoped(ctx, 'masjids').findOne({ _id: input.masjidId });
    if (!masjid) throw new StateError('MASJID_NOT_FOUND');
    // The admin cell reads verified entries only.
    const entry = await scoped(ctx, 'content_library').findOne({ _id: dua.libraryId, kind: 'dua' });
    if (!entry) throw new StateError('LIBRARY_ENTRY_NOT_FOUND');
    const version = (numberOf(masjid, 'content_version') ?? 0) + 1;

    const published = await contentWrite(ctx, input.masjidId, async (store) => {
      const item = await insertPublishedItem(
        store,
        {
          type: 'dua_request',
          audience: 'everyone',
          isImportant: false,
          notify: dua.notify,
          body: dua.message,
          contentLocale: dua.locale,
          detail: {
            dua: {
              category: dua.category,
              ...(dua.personName === undefined ? {} : { person_name: dua.personName }),
              name_private: dua.namePrivate,
              library_id: dua.libraryId,
              ...(dua.janazaAt === undefined ? {} : { janaza_at: dua.janazaAt }),
              ...(dua.janazaPlace === undefined ? {} : { janaza_place: dua.janazaPlace }),
            },
          },
          createdBy: adminId,
          masjidVisible: masjid['status'] === 'active',
          version,
        },
        now,
      );
      if (!dua.notify) return { item, quotaLeft: null };
      const limit = numberOf(masjid, 'push_daily_quota') ?? 0;
      const { used } = await enqueueNotification(
        store,
        { masjidId: input.masjidId, itemId: item.itemId, audience: 'everyone', limit },
        now,
      );
      return { item, quotaLeft: Math.max(0, limit - used) };
    });
    await writeAudit(ctx, {
      action: 'item.publish',
      masjidId: input.masjidId,
      targetType: 'items',
      targetId: idText(published.item.itemId),
      meta: { type: 'dua_request', template: null, notify: dua.notify, image: false },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return {
      item: { id: idText(published.item.itemId), publicId: published.item.publicId },
      quotaLeft: published.quotaLeft,
    };
  });
}
