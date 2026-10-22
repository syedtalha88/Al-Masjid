// zod/mini: this schema ships in both PWAs (every API error is parsed with it) — DECISIONS #92.
import * as z from 'zod/mini';

import { API_ERROR_CODES, type ApiErrorCode } from '../errors.ts';

/**
 * Error codes the API emits (the list lives in `../errors.ts` with each code's status). The client maps each to an
 * `errors.<CODE>` i18n key; a code it does not know (a newer server) falls back to a generic message, so the wire
 * schema accepts any code-shaped string while the server side stays a closed union.
 */
export const PROBLEM_CODES = API_ERROR_CODES;

export type ProblemCode = ApiErrorCode;

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
  status: z.int().check(z.minimum(400), z.maximum(599)),
  code: z.string().check(z.regex(/^[A-Z][A-Z0-9_]*$/)),
  detail: z.optional(z.string()),
  errors: z.optional(z.array(problemFieldErrorSchema)),
  requestId: z.optional(z.string()),
});

export type Problem = z.infer<typeof problemSchema>;
