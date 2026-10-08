import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';

import { ApiProblem, problemBody, sendProblem } from './problem.ts';
import { getRequestId } from './request-id.ts';

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
export function errorMapper(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const requestId = getRequestId(res);

    if (error instanceof ApiProblem) {
      sendProblem(
        res,
        problemBody(error.status, error.code, { detail: error.detail, errors: error.errors, requestId }),
      );
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
    sendProblem(res, problemBody(500, 'INTERNAL_ERROR', { requestId }));
  };
}
