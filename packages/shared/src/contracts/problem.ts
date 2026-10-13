import { z } from 'zod';

/**
 * Error codes the API emits today (03 header). The client maps each to an `errors.<CODE>` i18n key; a code it
 * does not know (a newer server) falls back to a generic message, so the wire schema accepts any code-shaped
 * string while the server side stays a closed union.
 */
export const PROBLEM_CODES = [
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'VALIDATION_FAILED',
  'UNSAFE_INPUT',
  'INVALID_JSON',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'CORS_NOT_ALLOWED',
  'INTERNAL_ERROR',
] as const;

export type ProblemCode = (typeof PROBLEM_CODES)[number];

/** One invalid field: dotted path (e.g. `body.locale`) and a machine-readable reason (Zod issue code). */
export const problemFieldErrorSchema = z.object({
  path: z.string(),
  code: z.string(),
});

export type ProblemFieldError = z.infer<typeof problemFieldErrorSchema>;

/** RFC 9457 `application/problem+json` body as sent by `packages/api` (DECISIONS #33). */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.int().min(400).max(599),
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  detail: z.string().optional(),
  errors: z.array(problemFieldErrorSchema).optional(),
  requestId: z.string().optional(),
});

export type Problem = z.infer<typeof problemSchema>;
