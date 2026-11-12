// zod/mini (DECISIONS #92) like `admin-items.ts`: the moderation queue embeds the musalli `feedItemSchema` (a post is
// shown exactly as musallis see it — 07 C5). 03 §5 `GET /reports`, PHASE_08 T8.2. The request bodies are classic Zod
// in `super.ts` (they use `safeText`).
import * as z from 'zod/mini';

import { feedItemSchema } from './public.ts';

const instant = z.iso.datetime();

export const REPORT_STATUS_VALUES = ['open', 'actioned', 'dismissed'] as const;

export const queueReportSchema = z.object({
  id: z.string(),
  reason: z.string(),
  details: z.optional(z.string()),
  urgent: z.boolean(),
  createdAt: instant,
  dueAt: instant,
});

/** What reports are about — a post or a masjid — with its reports, earliest due first within the queue. */
export const queueTargetSchema = z.object({
  targetType: z.enum(['item', 'masjid']),
  targetId: z.string(),
  masjid: z.object({ id: z.string(), name: z.string(), removals90d: z.int().check(z.minimum(0)) }),
  urgent: z.boolean(),
  dueAt: instant,
  reports: z.array(queueReportSchema),
  itemStatus: z.optional(z.string()),
  item: z.optional(feedItemSchema),
  postedBy: z.optional(z.string()),
  removedReason: z.optional(z.string()),
});
export type QueueTargetView = z.infer<typeof queueTargetSchema>;

export const moderationQueueSchema = z.object({ targets: z.array(queueTargetSchema) });
export type ModerationQueue = z.infer<typeof moderationQueueSchema>;

/** `POST /items/:id/remove` / `restore` answer: the CDN purge was queued (if not, "Clear the cache again"). */
export const moderationResultSchema = z.object({
  publicId: z.string(),
  reports: z.int().check(z.minimum(0)),
  cdnPurgeQueued: z.boolean(),
});
export type ModerationResult = z.infer<typeof moderationResultSchema>;

/** `POST /items/:publicId/purge` answer. */
export const cdnPurgeSchema = z.object({ cdnPurgeQueued: z.boolean() });
/** `POST /reports/:id/dismiss` answer. */
export const dismissedSchema = z.object({ dismissed: z.literal(true) });
