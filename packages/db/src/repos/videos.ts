// Bayan reads for B10 (PHASE_06 T6.2): the masjid's bayans — published, removed by moderation, deleted — newest first.
// Through the policy gateway (own masjids only). Never the pasted link: only the id we stored.
import type { Document, UUID } from 'mongodb';

import type { DbHandle } from '../client.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText } from '../values.ts';
import { requireOwnMasjid } from './admin.ts';
import { need, numberOf, text } from './read.ts';

export type AdminVideoStatus = 'published' | 'removed' | 'deleted';

export interface AdminVideoRow {
  readonly id: string;
  readonly publicId: string;
  readonly status: AdminVideoStatus;
  readonly title: string;
  readonly speaker?: string;
  readonly description?: string;
  readonly audience: 'everyone' | 'brothers' | 'sisters';
  readonly youtubeId: string;
  readonly startS?: number;
  readonly thumb: { readonly key: string; readonly thumbhash: string };
  readonly publishedAt: string;
  /** The If-Match of an edit. */
  readonly updatedAt: string;
}

/** Most bayans B10 lists. */
const LIST_MAX = 100;
const iso = (value: unknown): string => (value instanceof Date ? value : new Date(0)).toISOString();

function videoRowOf(item: Document): AdminVideoRow {
  const video = (item['video'] ?? {}) as Document; // by schema
  const speaker = text(video, 'speaker');
  const description = text(item, 'body');
  const startS = numberOf(video, 'start_s');
  return {
    id: idText(item['_id'] as UUID), // a UUID by schema
    publicId: need(item, 'public_id'),
    status: item['status'] as AdminVideoStatus, // the filter below
    title: text(item, 'title') ?? '',
    ...(speaker === undefined ? {} : { speaker }),
    ...(description === undefined ? {} : { description }),
    audience: item['audience'] as AdminVideoRow['audience'], // enum by schema
    youtubeId: need(video, 'youtube_id'),
    ...(startS === undefined ? {} : { startS }),
    thumb: { key: need(video, 'thumb_key'), thumbhash: text(video, 'thumb_thumbhash') ?? '' },
    publishedAt: iso(item['published_at']),
    updatedAt: iso(item['updated_at']),
  };
}

/**
 * `GET /masjids/:id/videos` (B10): the masjid's bayans, newest first — published, removed by moderation, deleted.
 *
 * @throws StateError MASJID_NOT_FOUND outside the admin's masjids.
 */
export async function listVideosForAdmin(
  handle: DbHandle,
  scope: Scope,
  masjidId: UUID,
): Promise<{ videos: AdminVideoRow[] }> {
  requireOwnMasjid(scope, masjidId);
  const db = await handle.db();
  const docs = await scoped({ scope, db }, 'items').find(
    { masjid_id: masjidId, type: 'video', status: { $in: ['published', 'removed', 'deleted'] } },
    { sort: { published_at: -1 }, limit: LIST_MAX },
  );
  return { videos: docs.map(videoRowOf) };
}
