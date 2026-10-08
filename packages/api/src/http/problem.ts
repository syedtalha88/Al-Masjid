import type { Response } from 'express';

/** Stable error codes; the client maps each to an `errors.<CODE>` i18n key (09 §2). */
export type ProblemCode =
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'VALIDATION_FAILED'
  | 'UNSAFE_INPUT'
  | 'INVALID_JSON'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'CORS_NOT_ALLOWED'
  | 'INTERNAL_ERROR';

export interface ProblemFieldError {
  /** Dotted path of the offending field, e.g. `body.locale`. */
  readonly path: string;
  /** Machine-readable reason (Zod issue code). */
  readonly code: string;
}

/** RFC 9457 problem details body (03 header). */
export interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ProblemCode;
  readonly detail?: string;
  readonly errors?: readonly ProblemFieldError[];
  readonly requestId?: string;
}

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  500: 'Internal Server Error',
};

/**
 * An error that maps to a specific problem+json response. Throw it from handlers/middleware; the error
 * mapper renders it. `detail` must be safe to show to end users (no internals, no other tenants' ids).
 */
export class ApiProblem extends Error {
  override readonly name = 'ApiProblem';

  constructor(
    readonly status: number,
    readonly code: ProblemCode,
    readonly detail?: string,
    readonly errors?: readonly ProblemFieldError[],
  ) {
    super(`${String(status)} ${code}${detail === undefined ? '' : `: ${detail}`}`);
  }
}

/**
 * Builds a problem body. `type` is a URN per code so clients can switch on it without a web page.
 */
export function problemBody(
  status: number,
  code: ProblemCode,
  extra: {
    detail?: string | undefined;
    errors?: readonly ProblemFieldError[] | undefined;
    requestId?: string | undefined;
  } = {},
): ProblemBody {
  return {
    type: `urn:masjid-connect:problem:${code.toLowerCase().replace(/_/g, '-')}`,
    title: TITLES[status] ?? 'Error',
    status,
    code,
    ...(extra.detail === undefined ? {} : { detail: extra.detail }),
    ...(extra.errors === undefined ? {} : { errors: extra.errors }),
    ...(extra.requestId === undefined ? {} : { requestId: extra.requestId }),
  };
}

/** Writes a problem+json response with `Cache-Control: no-store`. */
export function sendProblem(res: Response, body: ProblemBody): void {
  res.status(body.status).type('application/problem+json').set('Cache-Control', 'no-store').send(JSON.stringify(body));
}
