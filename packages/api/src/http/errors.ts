import { StateError } from '@mc/db';
import { API_ERRORS, type ApiErrorCode } from '@mc/shared/errors';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';

import { ApiProblem, problemBody, sendProblem } from './problem.ts';
import { getRequestId } from './request-id.ts';

/**
 * State-function refusals (`StateError` from `@mc/db`) that are answers for the client, mapped to API codes. Anything
 * else a state function throws (an internal invariant such as AUDIT_META or COUNTER_REGRESSION handled by its route)
 * stays a 500, so internal codes never leak.
 */
const STATE_CODES: Readonly<Record<string, ApiErrorCode>> = {
  FORBIDDEN: 'FORBIDDEN',
  STEP_UP_REQUIRED: 'STEP_UP_REQUIRED',
  MASJID_NOT_FOUND: 'MASJID_NOT_FOUND',
  ADMIN_NOT_FOUND: 'ADMIN_NOT_FOUND',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  ACTIVATION_REQUIREMENTS: 'ACTIVATION_REQUIREMENTS',
  ADMIN_LIMIT_REACHED: 'ADMIN_LIMIT_REACHED',
  FOLLOW_LIMIT_REACHED: 'FOLLOW_LIMIT_REACHED',
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  NOT_MEMBER: 'NOT_MEMBER',
  INVITE_INVALID: 'INVITE_INVALID',
  NOTHING_TO_UPDATE: 'NOTHING_TO_UPDATE',
  INVALID_CURSOR: 'INVALID_CURSOR',
  UNDERTAKING_VERSION_MISMATCH: 'UNDERTAKING_VERSION_MISMATCH',
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
  LIBRARY_ENTRY_NOT_FOUND: 'LIBRARY_ENTRY_NOT_FOUND',
  LIBRARY_DUPLICATE: 'LIBRARY_DUPLICATE',
  LIBRARY_FIELD_NOT_FOR_KIND: 'VALIDATION_FAILED',
  // The authenticated device was deleted meanwhile (Clear all data on another tab): the app registers again.
  DEVICE_NOT_FOUND: 'DEVICE_AUTH_REQUIRED',
};

/** The API problem for a client-facing state refusal, or `undefined` for internal ones. */
export function stateProblem(error: StateError): ApiProblem | undefined {
  const code = STATE_CODES[error.code];
  return code ? new ApiProblem(API_ERRORS[code], code) : undefined;
}

/** Middleware 9 (03 §0): unknown API route → problem+json 404 (uniform, reveals nothing). */
export function notFound(): RequestHandler {
  return (_req, res) => {
    sendProblem(res, problemBody(404, 'NOT_FOUND', { requestId: getRequestId(res) }));
  };
}

interface BodyParserError {
  readonly type: string;
  readonly status: number;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { type?: unknown }).type === 'string' &&
    typeof (error as { status?: unknown }).status === 'number'
  );
}

/**
 * Middleware 10 (03 §0): maps any error to problem+json. Never leaks stack traces, database errors,
 * queries or internal ids — unexpected errors become a generic 500 and are logged with the request id.
 * Request validation errors arrive as ApiProblem (from defineRoute); a bare ZodError reaching this point
 * means server-side data failed a schema, so it is deliberately a 500 rather than a 400.
 */
/** Receives unexpected errors (the 500s) for error tracking; set by the entrypoints (Sentry — T0.13). */
export type ErrorReporter = (error: unknown, context: { readonly requestId: string | undefined }) => void;

export function errorMapper(logger: Logger, reportError?: ErrorReporter): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const requestId = getRequestId(res);

    if (error instanceof ApiProblem) {
      res.set(error.headers);
      sendProblem(
        res,
        problemBody(error.status, error.code, { detail: error.detail, errors: error.errors, requestId }),
      );
      return;
    }
    const mapped = error instanceof StateError ? stateProblem(error) : undefined;
    if (mapped) {
      sendProblem(res, problemBody(mapped.status, mapped.code, { requestId }));
      return;
    }
    if (isBodyParserError(error)) {
      if (error.type === 'entity.too.large') {
        sendProblem(res, problemBody(413, 'PAYLOAD_TOO_LARGE', { requestId }));
        return;
      }
      if (error.type === 'entity.parse.failed') {
        sendProblem(res, problemBody(400, 'INVALID_JSON', { requestId }));
        return;
      }
      if (error.type === 'charset.unsupported' || error.type === 'encoding.unsupported') {
        sendProblem(res, problemBody(415, 'UNSUPPORTED_MEDIA_TYPE', { requestId }));
        return;
      }
    }

    logger.error({ err: error, requestId }, 'unhandled error');
    reportError?.(error, { requestId });
    sendProblem(res, problemBody(500, 'INTERNAL_ERROR', { requestId }));
  };
}
