// My Posts (07 B12, 03 §4 `GET /items?type=&status=&cursor=`, PHASE_03 T3.9): the admin's own posts in every status,
// newest first — each in the shape musallis receive (`itemOf`, so "View" is the musalli card), plus what only the
// masjid sees: the status, `updated_at` (the edit's If-Match), until when it can be edited, a private dua name (the
// masjid's own record — never in the public view, 02 §4.2) and, for removed posts, the moderation reason (their title,
// body and photo are hidden by the admin cell — 02 §4.1).
import type { Document, UUID } from 'mongodb';

import type { DbHandle } from '../client.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText } from '../values.ts';
import { requireOwnMasjid } from './admin.ts';
import {
  decodeCursor,
  encodeCursor,
  FEED_PAGE_MAX,
  itemOf,
  libraryIdOf,
  libraryOf,
  type PublicItem,
  type PublicLibraryEntry,
} from './public.ts';
import { idOf, iso, objectOf, text } from './read.ts';

/** 00 §4.3: posts are editable this long after publishing (the state function checks it again). */
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const EDITABLE = new Set(['announcement', 'daily_content', 'dua_request']);

export type AdminItemStatus = 'published' | 'hidden' | 'deleted' | 'removed';
const STATUSES: readonly AdminItemStatus[] = ['published', 'hidden', 'deleted', 'removed'];

export interface AdminItemRow {
  readonly id: string;
  readonly status: AdminItemStatus;
  readonly updatedAt: string;
  /** Published, an editable type and within 24 h of publishing: until when (ISO). */
  readonly editableUntil?: string;
  /** The attached library entry's id (B6 / B7 edits keep it even when the entry was retired meanwhile). */
  readonly libraryId?: string;
  /** A dua request's name kept private — shown to the masjid's admins only. */
  readonly privateName?: string;
  readonly removedReason?: string;
  readonly deletedAt?: string;
  readonly item: PublicItem;
}

const statusOf = (doc: Document): AdminItemStatus => {
  const status: unknown = doc['status'];
  return status === 'deleted' || status === 'removed' || status === 'hidden' ? status : 'published';
};

/**
 * The masjid's posts, newest first, `FEED_PAGE_MAX` a page.
 *
 * @param input.type - one item type, or all.
 * @param input.status - one status, or all three.
 * @returns the rows and the next cursor (`null` at the end).
 * @throws StateError MASJID_NOT_FOUND (not one of the admin's masjids), INVALID_CURSOR.
 */
export async function listItemsForAdmin(
  handle: DbHandle,
  scope: Scope,
  masjidId: UUID,
  input: {
    readonly type?: string | undefined;
    readonly status?: AdminItemStatus | undefined;
    readonly cursor?: string | undefined;
    readonly now: Date;
  },
): Promise<{ rows: AdminItemRow[]; next: string | null }> {
  requireOwnMasjid(scope, masjidId);
  const db = await handle.db();
  const after = input.cursor ? decodeCursor(input.cursor) : undefined;
  const docs = await scoped({ scope, db }, 'items').find(
    {
      masjid_id: masjidId,
      status: { $in: input.status ? [input.status] : [...STATUSES] },
      ...(input.type ? { type: input.type } : {}),
      ...(after
        ? { published_at: { $lte: after.at }, $or: [{ published_at: { $lt: after.at } }, { _id: { $lt: after.id } }] }
        : {}),
    },
    { sort: { published_at: -1, _id: -1 }, limit: FEED_PAGE_MAX + 1 },
  );
  const page = docs.slice(0, FEED_PAGE_MAX);
  const ids = [
    ...new Map(
      page.flatMap((doc) => {
        const id = libraryIdOf(doc);
        return id ? [[idText(id), id] as const] : [];
      }),
    ).values(),
  ];
  const library = new Map<string, PublicLibraryEntry>();
  if (ids.length > 0) {
    // The admin cell reads verified entries only: a retired entry leaves the card without its text.
    for (const entry of await scoped({ scope, db }, 'content_library').find({ _id: { $in: ids } })) {
      library.set(idOf(entry), libraryOf(entry));
    }
  }
  const rows = page.map((doc): AdminItemRow => {
    const status = statusOf(doc);
    const published: unknown = doc['published_at'];
    const editableUntil =
      status === 'published' && EDITABLE.has(String(doc['type'])) && published instanceof Date
        ? new Date(published.getTime() + EDIT_WINDOW_MS)
        : undefined;
    const dua = objectOf(doc, 'dua');
    const privateName = dua && dua['name_private'] === true ? text(dua, 'person_name') : undefined;
    const libraryId = libraryIdOf(doc);
    const removedReason = status === 'removed' ? text(doc, 'removed_reason') : undefined;
    const deletedAt = iso(doc, 'deleted_at');
    return {
      id: idOf(doc),
      status,
      updatedAt: iso(doc, 'updated_at') ?? '',
      ...(editableUntil && editableUntil.getTime() > input.now.getTime()
        ? { editableUntil: editableUntil.toISOString() }
        : {}),
      ...(libraryId ? { libraryId: idText(libraryId) } : {}),
      ...(privateName ? { privateName } : {}),
      ...(removedReason ? { removedReason } : {}),
      ...(deletedAt ? { deletedAt } : {}),
      item: itemOf(doc, library),
    };
  });
  const last = page.at(-1);
  return { rows, next: docs.length > FEED_PAGE_MAX && last ? encodeCursor(last) : null };
}
