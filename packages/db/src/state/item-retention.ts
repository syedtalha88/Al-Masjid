// The `retention` job's part for posts (02 §6, PHASE_06 T6.4 — the items rows of PHASE_08 T8.7, built early): a post
// deleted by its masjid or removed by moderation is kept 180 days (`purge_after`, IT Rules preservation), then deleted
// for good with its Ameens and Ameen counter. The media it carried — photo, voice note, a bayan's thumbnail copy, a
// drive's cover — is returned for the worker to delete from storage and purge from the CDN.
import type { UUID } from 'mongodb';

import { type DbHandle, withTransaction } from '../client.ts';
import { StateError } from '../effects.ts';
import type { Scope } from '../scope.ts';

/** Most posts one run purges (the next run continues — 03:00 IST daily). */
export const ITEM_PURGE_BATCH = 1000;

/** What a purged post carried, by storage kind (keys as stored). */
export interface PurgedMedia {
  readonly images: readonly string[];
  readonly audio: readonly string[];
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
  const images = [
    textAt(item, 'image_key'),
    textAt(objectAt(item, 'video'), 'thumb_key'),
    textAt(objectAt(item, 'campaign'), 'cover_key'),
  ].filter((key): key is string => key !== undefined && !key.startsWith('seed/'));
  const audio = [textAt(objectAt(item, 'voice'), 'key')].filter(
    (key): key is string => key !== undefined && !key.startsWith('seed/'),
  );
  return { images: [...new Set(images)], audio };
}

/**
 * Purges every deleted / removed post whose `purge_after` has passed (system scope, `mc_system`): the document, its
 * Ameens and its Ameen counter — one transaction per post, so a post is either gone with them or untouched.
 *
 * @param input.limit - at most this many posts (default {@link ITEM_PURGE_BATCH}).
 * @returns how many were purged and the media they carried (the caller deletes the files and purges the CDN; a key
 *   still used by a live post is not returned).
 * @throws StateError FORBIDDEN outside the system scope.
 */
export async function purgeExpiredItems(
  handle: DbHandle,
  scope: Scope,
  input: { readonly now: Date; readonly limit?: number | undefined },
): Promise<{ purged: number; media: PurgedMedia }> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  const db = await handle.db();
  const due = await db
    .collection<ItemDoc>('items')
    .find(
      { status: { $in: ['deleted', 'removed'] }, purge_after: { $lte: input.now } },
      { limit: input.limit ?? ITEM_PURGE_BATCH },
    )
    .toArray();
  let purged = 0;
  const images = new Set<string>();
  const audio = new Set<string>();
  for (const item of due) {
    const gone = await withTransaction(handle, scope, async (ctx) => {
      const session = { session: ctx.session };
      const deleted = await ctx.db
        .collection<ItemDoc>('items')
        .deleteOne(
          { _id: item._id, status: { $in: ['deleted', 'removed'] }, purge_after: { $lte: input.now } },
          session,
        );
      if (deleted.deletedCount !== 1) return false;
      await ctx.db.collection<{ dua_item_id: UUID }>('ameens').deleteMany({ dua_item_id: item._id }, session);
      await ctx.db.collection<{ _id: UUID }>('ameen_counters').deleteOne({ _id: item._id }, session);
      return true;
    });
    if (!gone) continue;
    purged += 1;
    const media = mediaOf(item);
    for (const key of media.images) images.add(key);
    for (const key of media.audio) audio.add(key);
  }
  // A file still referenced by a remaining post stays (a reused cover or thumbnail).
  const usedImages = new Set<string>();
  const usedAudio = new Set<string>();
  if (images.size + audio.size > 0) {
    const imageKeys = [...images];
    const remaining = await db
      .collection<ItemDoc>('items')
      .find(
        {
          $or: [
            { image_key: { $in: imageKeys } },
            { 'video.thumb_key': { $in: imageKeys } },
            { 'campaign.cover_key': { $in: imageKeys } },
            { 'voice.key': { $in: [...audio] } },
          ],
        },
        { projection: { image_key: 1, video: 1, campaign: 1, voice: 1 } },
      )
      .toArray();
    for (const row of remaining) {
      const media = mediaOf(row);
      for (const key of media.images) usedImages.add(key);
      for (const key of media.audio) usedAudio.add(key);
    }
  }
  return {
    purged,
    media: {
      images: [...images].filter((key) => !usedImages.has(key)),
      audio: [...audio].filter((key) => !usedAudio.has(key)),
    },
  };
}
