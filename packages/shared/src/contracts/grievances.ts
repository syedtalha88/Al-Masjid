import { z } from 'zod';

import { safeText } from './text.ts';

// Grievances (03 §3 `POST /grievances`, 03 §5 C6, PHASE_08 T8.4). Classic Zod with `safeText` (04 §6); the musalli PWA
// imports only the types (the form is lazy and checks lengths itself).

export const GRIEVANCE_CATEGORIES = ['privacy', 'content', 'technical', 'feedback', 'other'] as const;
export const GRIEVANCE_DESCRIPTION_MAX = 2000;
/** An e-mail address or a phone number, only if the person wants a reply (00 §4.7). */
export const GRIEVANCE_CONTACT_MAX = 200;

export const grievanceRequestSchema = z.strictObject({
  category: z.enum(GRIEVANCE_CATEGORIES),
  description: safeText(GRIEVANCE_DESCRIPTION_MAX, { min: 1, multiline: true }),
  contact: safeText(GRIEVANCE_CONTACT_MAX).optional(),
  turnstileToken: z.string().min(1).max(2048),
});
export type GrievanceRequest = z.input<typeof grievanceRequestSchema>;

export const grievanceReceivedSchema = z.strictObject({ publicRef: z.string().regex(/^GR-\d{4}-\d{6}$/) });
export type GrievanceReceived = z.infer<typeof grievanceReceivedSchema>;

export const GRIEVANCE_STATUSES = ['open', 'acknowledged', 'resolved', 'rejected'] as const;

/** C6 tracker rows — never the contact (★ "Show contact" asks for it separately). */
export const grievanceListSchema = z.object({
  grievances: z.array(
    z.object({
      id: z.string(),
      publicRef: z.string(),
      category: z.enum(GRIEVANCE_CATEGORIES),
      description: z.string(),
      hasContact: z.boolean(),
      status: z.enum(GRIEVANCE_STATUSES),
      createdAt: z.string(),
      ackDueAt: z.string(),
      resolveDueAt: z.string(),
      acknowledgedAt: z.string().optional(),
      resolvedAt: z.string().optional(),
      resolution: z.string().optional(),
    }),
  ),
});
export type GrievanceList = z.infer<typeof grievanceListSchema>;

export const resolveGrievanceRequestSchema = z.strictObject({
  status: z.enum(['resolved', 'rejected']),
  resolution: safeText(GRIEVANCE_DESCRIPTION_MAX, { min: 1, multiline: true }),
});

export const grievanceContactSchema = z.object({ contact: z.string().nullable() });
export const grievanceAckSchema = z.object({ acknowledged: z.literal(true) });
export const grievanceResolvedSchema = z.object({ status: z.enum(['resolved', 'rejected']) });
