import { z } from 'zod';

import { REPORT_DETAILS_MAX, REPORT_REASONS } from '../compliance.ts';
import { safeText } from './text.ts';

// `POST /reports` (03 §3, PHASE_08 T8.1). Classic Zod with `safeText` (04 §6): the API validates with it; the musalli
// PWA imports only the types (its report sheet is lazy and checks lengths itself), so nothing here reaches the first
// load. A post is addressed by its 12-character public id, a masjid by its id.

const PUBLIC_ID = /^[A-Za-z0-9_-]{12}$/u;
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export const reportRequestSchema = z
  .strictObject({
    targetType: z.enum(['item', 'masjid']),
    targetPublicId: z.string().max(36),
    reason: z.enum(REPORT_REASONS),
    details: safeText(REPORT_DETAILS_MAX, { multiline: true }).optional(),
    turnstileToken: z.string().min(1).max(2048),
  })
  .refine(
    (body) => (body.targetType === 'item' ? PUBLIC_ID.test(body.targetPublicId) : UUID_TEXT.test(body.targetPublicId)),
    { message: 'targetPublicId does not match targetType', path: ['targetPublicId'] },
  );
export type ReportRequest = z.input<typeof reportRequestSchema>;

/** The reporter learns only that it arrived — nothing about other reports or what happens next. */
export const reportResponseSchema = z.strictObject({ received: z.literal(true) });
export type ReportResponse = z.infer<typeof reportResponseSchema>;
