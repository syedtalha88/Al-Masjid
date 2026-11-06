// zod/mini (DECISIONS #92) like `public.ts`: My Posts embeds the musalli `feedItemSchema`, and a classic Zod object
// cannot hold a Zod Mini schema (the OpenAPI generator reads classic schemas only — a whole Mini schema becomes JSON
// Schema). 07 B12, 03 §4 `GET /items`, PHASE_03 T3.9.
import * as z from 'zod/mini';

import { feedItemSchema } from './public.ts';

const instant = z.iso.datetime();

/**
 * One of the masjid's posts: the item as musallis receive it (`FeedItem` — "View" renders the musalli card) and what
 * only the masjid sees — status, `updatedAt` (the edit's If-Match), until when it can be edited, the attached library
 * entry's id, a private dua name, the moderation reason of a removed post (its title, body and photo are hidden).
 */
export const adminItemSchema = z.object({
  id: z.string(),
  status: z.enum(['published', 'deleted', 'removed']),
  updatedAt: instant,
  editableUntil: z.optional(instant),
  libraryId: z.optional(z.string()),
  privateName: z.optional(z.string()),
  removedReason: z.optional(z.string()),
  deletedAt: z.optional(instant),
  item: feedItemSchema,
});
export type AdminItem = z.infer<typeof adminItemSchema>;

/** `GET /masjids/:masjidId/items` — newest first; `next` is an opaque cursor or `null` at the end. */
export const adminItemListSchema = z.object({ items: z.array(adminItemSchema), next: z.nullable(z.string()) });
export type AdminItemList = z.infer<typeof adminItemListSchema>;
