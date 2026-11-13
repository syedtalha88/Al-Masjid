import { z } from 'zod';

import { safeText } from './text.ts';

// Legal orders register (03 §5 `/legal-orders`, 07 C7, PHASE_08 T8.5). Super Admin only; the document is a separate
// multipart upload (`POST /legal-orders/:id/document`) and a ★ download.

export const LEGAL_ORDER_STATUSES = ['received', 'actioned', 'contested', 'closed'] as const;
export const LEGAL_TARGET_TYPES = ['items', 'masjids', 'other'] as const;
export const LEGAL_SUMMARY_MAX = 2000;
export const LEGAL_NOTE_MAX = 500;
/** The order's document: PDF, JPEG or PNG (by content), at most 8 MB (Cloudinary's free plan takes raw files ≤ 10 MB). */
export const LEGAL_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;

export const legalOrderCreateSchema = z.strictObject({
  authority: safeText(200, { min: 1 }),
  referenceNo: safeText(120, { min: 1 }),
  /** When the order reached us (entered — the 3-hour clock starts here); not in the future. */
  receivedAt: z.iso.datetime({ offset: true }),
  targetType: z.enum(LEGAL_TARGET_TYPES),
  /** A post's link / id, a masjid's follow code / id, or a short description for `other`. */
  target: safeText(300, { min: 1 }),
  summary: safeText(LEGAL_SUMMARY_MAX, { min: 1, multiline: true }),
});
export type LegalOrderCreate = z.input<typeof legalOrderCreateSchema>;

export const legalOrderPatchSchema = z.strictObject({
  status: z.enum(LEGAL_ORDER_STATUSES).optional(),
  actionTaken: safeText(LEGAL_SUMMARY_MAX, { min: 1, multiline: true }).optional(),
  note: safeText(LEGAL_NOTE_MAX, { min: 1, multiline: true }).optional(),
});
export type LegalOrderPatch = z.input<typeof legalOrderPatchSchema>;

export const legalOrderRowSchema = z.object({
  id: z.string(),
  authority: z.string(),
  referenceNo: z.string(),
  receivedAt: z.string(),
  dueAt: z.string(),
  targetType: z.enum(LEGAL_TARGET_TYPES),
  targetId: z.string(),
  summary: z.string(),
  actionTaken: z.string().optional(),
  actionLog: z.array(z.object({ at: z.string(), note: z.string() })),
  status: z.enum(LEGAL_ORDER_STATUSES),
  hasDocument: z.boolean(),
  createdAt: z.string(),
});
export const legalOrderListSchema = z.object({ orders: z.array(legalOrderRowSchema) });
export type LegalOrderList = z.infer<typeof legalOrderListSchema>;

export const legalOrderCreatedSchema = z.object({ id: z.string(), dueAt: z.string() });
export const legalOrderUpdatedSchema = z.object({ status: z.enum(LEGAL_ORDER_STATUSES) });
export const legalOrderDocumentSavedSchema = z.object({ hasDocument: z.literal(true) });
