// The `retention` job's part for posts (02 §5–§6, PHASE_06 T6.4 — the items rows of PHASE_08 T8.7, built early): a post
// deleted by its masjid or removed by moderation is kept 180 days (`purge_after`, IT Rules preservation), then deleted
// for good. Two steps so nothing is stranded (security review #165 M1): the job first lists due posts with the media
// files only they use, deletes those files and purges the CDN, and only then deletes the document — a failure leaves
// the document, and the next run tries the whole post again (deleting a missing file and purging twice are harmless).
// A post named in an open legal order is held (#165 L3, IT Rules 3(1)(g) — preservation on request).
import type { UUID } from 'mongodb';

import { type DbHandle, withTransaction } from '../client.ts';
import { StateError } from '../effects.ts';
import type { Scope } from '../scope.ts';
import { idText } from '../values.ts';

/** Most posts one run handles (the next run continues — 03:00 IST daily). */
export const ITEM_PURGE_BATCH = 1000;

/** Media files by storage kind (keys as stored). */
export interface PurgedMedia {
  readonly images: readonly string[];
  readonly audio: readonly string[];
}

/** A post whose 180 days are over, with the files only it still uses. */
export interface ExpiredItem {
  readonly id: UUID;
  readonly media: PurgedMedia;
}

type ItemDoc = { _id: UUID } & Record<string, unknown>;

const textAt = (doc: Record<string, unknown> | undefined, key: string): string | undefined => {
  const value = doc?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
};
const objectAt = (doc: Record<string, unknown>, key: string): Record<string, unknown> | undefined => {
  const value = doc[key];
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined; // checked
};

/** The stored media keys of one post. Seed placeholders (`seed/…`) have no stored file. */
export function mediaOf(item: Record<string, unknown>): PurgedMedia {
  const stored = (key: string | undefined): key is string => key !== undefined && !key.startsWith('seed/');
  const images = [
    textAt(item, 'image_key'),
    textAt(objectAt(item, 'video'), 'thumb_key'),
    textAt(objectAt(item, 'campaign'), 'cover_key'),
  ].filter(stored);
  const audio = [textAt(objectAt(item, 'voice'), 'key')].filter(stored);
  return { images: [...new Set(images)], audio };
}

const DUE = (now: Date) => ({ status: { $in: ['deleted', 'removed'] }, purge_after: { $lte: now } });
/** Legal orders still being handled hold their target (closed ones do not). */
const OPEN_ORDER = { status: { $in: ['received', 'actioned', 'contested'] } };

/**
 * Posts due for purging (system scope): deleted / removed, `purge_after` passed, not named in an open legal order —
 * each with the media files no other post, masjid photo or Ruqyah recording uses (#165 L1).
 *
 * @throws StateError FORBIDDEN outside the system scope.
 */
export async function listExpiredItems(
  handle: DbHandle,
  scope: Scope,
  input: { readonly now: Date; readonly limit?: number | undefined },
): Promise<ExpiredItem[]> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  const db = await handle.db();
  const held = new Set(
    (
      await db
        .collection<{ target_id: string }>('legal_orders')
        .find({ ...OPEN_ORDER, target_type: 'items' }, { projection: { target_id: 1 } })
        .toArray()
    ).map((order) => order.target_id),
  );
  const due = (
    await db
      .collection<ItemDoc>('items')
      .find(DUE(input.now), { limit: input.limit ?? ITEM_PURGE_BATCH })
      .toArray()
  ).filter((item) => !held.has(idText(item._id)));
  if (due.length === 0) return [];

  const images = [...new Set(due.flatMap((item) => mediaOf(item).images))];
  const audio = [...new Set(due.flatMap((item) => mediaOf(item).audio))];
  const dueIds = due.map((item) => item._id);
  // Who else uses these files: posts that stay (not due), masjid photos, Ruqyah recordings.
  const usedBy = new Map<string, number>();
  const count = (key: string) => usedBy.set(key, (usedBy.get(key) ?? 0) + 1);
  if (images.length + audio.length > 0) {
    const others = await db
      .collection<ItemDoc>('items')
      .find(
        {
          _id: { $nin: dueIds },
          $or: [
            { image_key: { $in: images } },
            { 'video.thumb_key': { $in: images } },
            { 'campaign.cover_key': { $in: images } },
            { 'voice.key': { $in: audio } },
          ],
        },
        { projection: { image_key: 1, video: 1, campaign: 1, voice: 1 } },
      )
      .toArray();
    for (const row of others) {
      const media = mediaOf(row);
      for (const key of [...media.images, ...media.audio]) count(key);
    }
    for (const row of await db
      .collection<{ photo_key?: string }>('masjids')
      .find({ photo_key: { $in: images } }, { projection: { photo_key: 1 } })
      .toArray()) {
      if (row.photo_key) count(row.photo_key);
    }
    for (const row of await db
      .collection<{ audio?: { key?: string } }>('ruqyah_entries')
      .find({ 'audio.key': { $in: audio } }, { projection: { audio: 1 } })
      .toArray()) {
      if (row.audio?.key) count(row.audio.key);
    }
  }
  // A file shared by two due posts is deleted with the first one only.
  const claimed = new Set<string>();
  const own = (key: string) => {
    if (usedBy.has(key) || claimed.has(key)) return false;
    claimed.add(key);
    return true;
  };
  return due.map((item) => {
    const media = mediaOf(item);
    return { id: item._id, media: { images: media.images.filter(own), audio: media.audio.filter(own) } };
  });
}

/**
 * Deletes one due post for good — after its files are gone — with its Ameens and Ameen counter, its campaign amount
 * history, and unlinks its chanda week (02 §5 "item purged by retention", #165 L2). One transaction; it re-checks that
 * the post is still due and not held.
 *
 * @returns whether it was deleted (false: no longer due — restored, already purged, or held meanwhile).
 * @throws StateError FORBIDDEN outside the system scope.
 */
export async function deleteExpiredItem(
  handle: DbHandle,
  scope: Scope,
  input: { readonly itemId: UUID; readonly now: Date },
): Promise<boolean> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  return withTransaction(handle, scope, async (ctx) => {
    const session = { session: ctx.session };
    const held = await ctx.db
      .collection<{ target_id: string }>('legal_orders')
      .countDocuments({ ...OPEN_ORDER, target_type: 'items', target_id: idText(input.itemId) }, session);
    if (held > 0) return false;
    const deleted = await ctx.db
      .collection<ItemDoc>('items')
      .deleteOne({ _id: input.itemId, ...DUE(input.now) }, session);
    if (deleted.deletedCount !== 1) return false;
    await ctx.db.collection<{ dua_item_id: UUID }>('ameens').deleteMany({ dua_item_id: input.itemId }, session);
    await ctx.db.collection<{ _id: UUID }>('ameen_counters').deleteOne({ _id: input.itemId }, session);
    await ctx.db
      .collection<{ campaign_item_id: UUID }>('campaign_amount_history')
      .deleteMany({ campaign_item_id: input.itemId }, session);
    await ctx.db
      .collection<{ item_id?: UUID }>('chanda_weeks')
      .updateMany({ item_id: input.itemId }, { $unset: { item_id: '' } }, session);
    return true;
  });
}
