import type { ProblemCode, ProblemFieldError } from '@mc/shared/contracts';
import type { Response } from 'express';

export type { ProblemCode, ProblemFieldError };

/** RFC 9457 problem details body (03 header); the wire contract is `problemSchema` in `@mc/shared/contracts`. */
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
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

/**
 * An error that maps to a specific problem+json response. Throw it from handlers/middleware; the error
 * mapper renders it. `detail` must be safe to show to end users (no internals, no other tenants' ids).
 */
export class ApiProblem extends Error {
  override readonly name = 'ApiProblem';
  readonly status: number;
  readonly code: ProblemCode;
  readonly detail: string | undefined;
  readonly errors: readonly ProblemFieldError[] | undefined;
  /** Response headers that belong to the problem (e.g. `Retry-After` on a 429). */
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    status: number,
    code: ProblemCode,
    detail?: string,
    errors?: readonly ProblemFieldError[],
    headers: Readonly<Record<string, string>> = {},
  ) {
    super(`${String(status)} ${code}${detail === undefined ? '' : `: ${detail}`}`);
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.errors = errors;
    this.headers = headers;
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
