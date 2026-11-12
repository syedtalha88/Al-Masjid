// Editing and deleting a post (00 §4.3 "edits allowed for 24h after publishing; edits do not re-notify", 03 §4
// `PATCH /items/:id` / `DELETE /items/:id`, 07 B12, PHASE_03 T3.9). An edit replaces what the item says with content
// checked exactly as at publish (the per-type builders), sets `edited_at` (musallis see "edited") and needs the
// `updated_at` the admin edited (If-Match — 412 when someone saved in between). A delete is a soft delete with the
// purge marker; musallis stop seeing the item at their next version poll. Removed (moderated) items are never touched
// — the admin update cell excludes them. Each runs in one transaction with the version bump and its audit entry.
import type { Document, UUID } from 'mongodb';

import { type DbHandle, type TxContext, withTransaction } from '../client.ts';
import { contentWrite, markItemForPurge, StateError, writeAudit } from '../effects.ts';
import { requireOwnMasjid } from '../repos/admin.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText } from '../values.ts';
import { announcementContent, type AnnouncementInput } from './announcements.ts';
import { dailyContent, type DailyContentInput } from './daily.ts';
import { duaContent, type DuaRequestInput } from './duas.ts';
import { PAYMENT_NOTICE_TEMPLATE } from './payment.ts';
import { contentDocument, type ItemContent, OPTIONAL_CONTENT_FIELDS } from './publish.ts';

/** 00 §4.3: a post can be edited for this long after it was first published. */
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The types B12 edits (timing updates are system posts; campaigns and videos come with their phases). */
export const EDITABLE_ITEM_TYPES = ['announcement', 'daily_content', 'dua_request'] as const;

/** An edit: the item's type and its new content, the publish input without "Notify followers" (edits never notify). */
export type ItemEdit =
  | { readonly type: 'announcement'; readonly announcement: Omit<AnnouncementInput, 'notify'> }
  | { readonly type: 'daily_content'; readonly daily: Omit<DailyContentInput, 'notify'> }
  | { readonly type: 'dua_request'; readonly dua: Omit<DuaRequestInput, 'notify'> };

/**
 * Notices the masjid may not edit or delete: "Payment details updated" is how followers learn that the UPI details
 * changed (04 R1) — a compromised admin account must not be able to hide it.
 */
const isLocked = (item: Document): boolean => item['template_key'] === PAYMENT_NOTICE_TEMPLATE;

/** The admin's own, non-removed item (the admin cells' fences), or `null`. */
const ownItem = (ctx: TxContext, masjidId: UUID, itemId: UUID): Promise<Document | null> =>
  scoped(ctx, 'items').findOne({ _id: itemId, masjid_id: masjidId });

async function contentOf(ctx: TxContext, masjidId: UUID, edit: ItemEdit, now: Date): Promise<ItemContent> {
  switch (edit.type) {
    case 'announcement':
      return announcementContent(ctx, masjidId, edit.announcement, now);
    case 'daily_content':
      return (await dailyContent(ctx, edit.daily, masjidId)).content;
    case 'dua_request':
      return duaContent(ctx, edit.dua, now, masjidId);
  }
}

/**
 * Edits one of the admin's published posts within 24 h of publishing.
 *
 * @param input.ifMatch - the item's `updated_at` as the admin last read it (ISO 8601).
 * @returns the new `updated_at` (the next If-Match).
 * @throws StateError MASJID_NOT_FOUND (outside the scope), ITEM_NOT_FOUND (unknown, another masjid's, deleted or
 *   removed), ITEM_NOT_EDITABLE (a timing update or another type than `edit.type`), EDIT_WINDOW_CLOSED (more than
 *   24 h after publishing), PRECONDITION_FAILED (saved meanwhile), and the publish checks of the type
 *   (ANNOUNCEMENT_INVALID, TEMPLATE_NOT_FOUND, LIBRARY_ENTRY_NOT_FOUND, DUA_INVALID) — nothing is written.
 */
export async function editItem(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly masjidId: UUID;
    readonly itemId: UUID;
    readonly ifMatch: string;
    readonly edit: ItemEdit;
    readonly requestId?: string | undefined;
    readonly now?: Date | undefined;
  },
): Promise<{ readonly updatedAt: string }> {
  requireOwnMasjid(scope, input.masjidId);
  if (scope.kind !== 'admin') throw new StateError('FORBIDDEN');
  const now = input.now ?? new Date();

  return withTransaction(handle, scope, async (ctx) => {
    const item = await ownItem(ctx, input.masjidId, input.itemId);
    if (!item || item['status'] !== 'published') throw new StateError('ITEM_NOT_FOUND');
    if (isLocked(item)) throw new StateError('ITEM_LOCKED');
    if (item['type'] !== input.edit.type) throw new StateError('ITEM_NOT_EDITABLE');
    const publishedAt: unknown = item['published_at'];
    if (!(publishedAt instanceof Date) || now.getTime() - publishedAt.getTime() > EDIT_WINDOW_MS) {
      throw new StateError('EDIT_WINDOW_CLOSED');
    }
    const updatedAt: unknown = item['updated_at'];
    if (!(updatedAt instanceof Date) || updatedAt.toISOString() !== input.ifMatch) {
      throw new StateError('PRECONDITION_FAILED');
    }
    const fields = contentDocument(await contentOf(ctx, input.masjidId, input.edit, now));
    const unset = OPTIONAL_CONTENT_FIELDS.filter((field) => !(field in fields));

    await contentWrite(ctx, input.masjidId, async (store) => {
      const matched = await scoped(store, 'items').updateOne(
        { _id: input.itemId, status: 'published', updated_at: updatedAt },
        {
          $set: { ...fields, edited_at: now, updated_at: now },
          ...(unset.length > 0 ? { $unset: Object.fromEntries(unset.map((field) => [field, ''])) } : {}),
        },
      );
      if (matched !== 1) throw new StateError('PRECONDITION_FAILED');
    });
    await writeAudit(ctx, {
      action: 'item.edit',
      masjidId: input.masjidId,
      targetType: 'items',
      targetId: idText(input.itemId),
      meta: { type: input.edit.type },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return { updatedAt: now.toISOString() };
  });
}

/**
 * Deletes one of the admin's posts (any type, any age): status `deleted`, the purge marker (180 days), the version bump
 * — musallis stop seeing it at their next poll. Deleting a deleted post again changes nothing.
 *
 * @throws StateError MASJID_NOT_FOUND (outside the scope), ITEM_NOT_FOUND (unknown, another masjid's or removed by
 *   moderation).
 */
export async function deleteItem(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly masjidId: UUID;
    readonly itemId: UUID;
    readonly requestId?: string | undefined;
    readonly now?: Date | undefined;
  },
): Promise<void> {
  requireOwnMasjid(scope, input.masjidId);
  if (scope.kind !== 'admin') throw new StateError('FORBIDDEN');
  const now = input.now ?? new Date();

  await withTransaction(handle, scope, async (ctx) => {
    const item = await ownItem(ctx, input.masjidId, input.itemId);
    if (!item || item['status'] === 'removed') throw new StateError('ITEM_NOT_FOUND');
    if (isLocked(item)) throw new StateError('ITEM_LOCKED');
    if (item['status'] === 'deleted') return;
    await contentWrite(ctx, input.masjidId, async (store) => {
      const matched = await scoped(store, 'items').updateOne(
        { _id: input.itemId, status: 'published' },
        { $set: { status: 'deleted', deleted_at: now, updated_at: now } },
      );
      if (matched !== 1) throw new StateError('ITEM_NOT_FOUND');
      await markItemForPurge(store, input.masjidId, input.itemId, now);
    });
    await writeAudit(ctx, {
      action: 'item.delete',
      masjidId: input.masjidId,
      targetType: 'items',
      targetId: idText(input.itemId),
      meta: { type: typeof item['type'] === 'string' ? item['type'] : null },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
}
