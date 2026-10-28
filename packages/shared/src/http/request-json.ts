// Core types and parse functions: work with classic Zod (admin) and Zod Mini (musalli app) schemas alike (DECISIONS #92).
import { type $ZodType, safeParse } from 'zod/v4/core';

import { type Problem, problemSchema } from '../contracts/problem.ts';

// `@mc/shared/http` — the one JSON client both PWAs use against our own API (03). Every response body is
// parsed with a Zod schema (CLAUDE.md §6: never trust a type you didn't validate); errors come back as typed
// `RequestError`s whose messages never contain response bodies, so they are safe to log and report.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestJsonOptions<T> {
  /** Schema for a 2xx body; for 204 it receives `undefined` (use `z.undefined()`). */
  readonly schema: $ZodType<T>;
  readonly method?: HttpMethod;
  /** Serialized as JSON with `Content-Type: application/json`. */
  readonly body?: unknown;
  /** A file upload instead of `body`: sent as `multipart/form-data` (the browser sets the boundary). */
  readonly form?: FormData;
  readonly headers?: Readonly<Record<string, string>>;
  /** Caller cancellation (e.g. TanStack Query's signal). */
  readonly signal?: AbortSignal;
  /** Gives up after this many ms (default 15 s, the API's own request timeout — 03 §0). */
  readonly timeoutMs?: number;
  /** Injectable for tests and the service worker. */
  readonly fetch?: typeof fetch;
}

export const DEFAULT_TIMEOUT_MS = 15_000;

/** Abort reason marking our own timeout (vs. the caller aborting). */
const TIMEOUT = Symbol('timeout');

/** Base class: `kind` tells the UI which friendly message to show (offline, retry, the problem code). */
export abstract class RequestError extends Error {
  abstract readonly kind: 'network' | 'problem' | 'response';
  /** `X-Request-Id` of the response, when there was one (support reference, 03 header). */
  readonly requestId: string | undefined;

  constructor(message: string, requestId: string | undefined, options?: ErrorOptions) {
    super(message, options);
    this.requestId = requestId;
  }
}

/** No HTTP response: offline, DNS/TLS failure, timeout or caller abort. */
export class NetworkError extends RequestError {
  override readonly name = 'NetworkError';
  readonly kind = 'network';
  readonly reason: 'failed' | 'timeout' | 'aborted';

  constructor(reason: NetworkError['reason'], options?: ErrorOptions) {
    super(`request ${reason}`, undefined, options);
    this.reason = reason;
  }
}

/** The API answered with an RFC 9457 problem; `problem.code` maps to an `errors.<CODE>` i18n key. */
export class ProblemError extends RequestError {
  override readonly name = 'ProblemError';
  readonly kind = 'problem';
  readonly status: number;
  readonly problem: Problem;

  constructor(problem: Problem, requestId: string | undefined) {
    super(`${String(problem.status)} ${problem.code}`, requestId ?? problem.requestId);
    this.status = problem.status;
    this.problem = problem;
  }
}

/** A response we cannot use: unexpected status without a problem body, not JSON, or the wrong shape. */
export class ResponseError extends RequestError {
  override readonly name = 'ResponseError';
  readonly kind = 'response';
  readonly status: number;
  readonly reason: 'unexpected-status' | 'not-json' | 'invalid-json' | 'invalid-shape';
  /** Paths of the schema issues (never the values) for `invalid-shape`. */
  readonly issues: readonly string[];

  constructor(
    status: number,
    reason: ResponseError['reason'],
    requestId: string | undefined,
    issues: readonly string[] = [],
  ) {
    super(`${String(status)} ${reason}${issues.length > 0 ? ` at ${issues.join(', ')}` : ''}`, requestId);
    this.status = status;
    this.reason = reason;
    this.issues = issues;
  }
}

const isJson = (contentType: string | null, subtype: 'json' | 'problem+json'): boolean => {
  const mime = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return subtype === 'json' ? mime === 'application/json' : mime === 'application/problem+json';
};

/**
 * Sends one JSON request and returns the validated body.
 *
 * @param url — absolute, or relative to the page (same-origin `/api/...`; cookies stay first-party).
 * @returns the 2xx body parsed by `options.schema` (`undefined` for 204).
 * @throws NetworkError when no response arrives (offline, timeout, abort);
 *   ProblemError for a problem+json error response;
 *   ResponseError for any other unusable response (wrong status, content type, JSON or shape).
 */
export async function requestJson<T>(url: string | URL, options: RequestJsonOptions<T>): Promise<T> {
  const {
    schema,
    method = 'GET',
    body,
    form,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetch: doFetch = fetch,
  } = options;
  if (body !== undefined && form !== undefined) throw new TypeError('requestJson: body and form exclude each other');
  const headers: Record<string, string> = {
    Accept: 'application/json, application/problem+json',
    ...options.headers,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  // Own controller instead of AbortSignal.any/timeout: iOS 16.4 Safari (installed-PWA push baseline) lacks any().
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(TIMEOUT);
  }, timeoutMs);
  const forwardAbort = () => {
    controller.abort();
  };
  if (signal?.aborted === true) controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  const abortReason = () => (controller.signal.reason === TIMEOUT ? 'timeout' : 'aborted');

  try {
    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers,
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(form === undefined ? {} : { body: form }),
      });
    } catch (error) {
      const reason = controller.signal.aborted ? abortReason() : 'failed';
      throw new NetworkError(reason, { cause: error });
    }
    return await readBody(response, schema, controller.signal);
  } catch (error) {
    // The body stream is cut by the same abort; report it as the abort, not as broken JSON.
    if (!(error instanceof NetworkError) && controller.signal.aborted) {
      throw new NetworkError(abortReason(), { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

async function readBody<T>(response: Response, schema: $ZodType<T>, signal: AbortSignal): Promise<T> {
  const requestId = response.headers.get('x-request-id') ?? undefined;
  const contentType = response.headers.get('content-type');

  if (!response.ok) {
    if (isJson(contentType, 'problem+json')) {
      const parsed = safeParse(problemSchema, await parseJson(response, requestId, signal));
      if (parsed.success) throw new ProblemError(parsed.data, requestId);
    }
    throw new ResponseError(response.status, 'unexpected-status', requestId);
  }
  if (response.status === 204) return validate(schema, undefined, response.status, requestId);
  if (!isJson(contentType, 'json')) throw new ResponseError(response.status, 'not-json', requestId);
  return validate(schema, await parseJson(response, requestId, signal), response.status, requestId);
}

async function parseJson(response: Response, requestId: string | undefined, signal: AbortSignal): Promise<unknown> {
  const text = await untilAborted(response.text(), signal);
  try {
    return JSON.parse(text) as unknown; // validated by the caller's schema next
  } catch {
    throw new ResponseError(response.status, 'invalid-json', requestId);
  }
}

/**
 * Rejects as soon as `signal` aborts, so the timeout also covers a body that stalls after the headers — not every
 * fetch (mocks, some service-worker responses) cancels the body stream when the request's signal aborts.
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new Error('body read aborted'));
    };
    if (signal.aborted) onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

function validate<T>(schema: $ZodType<T>, value: unknown, status: number, requestId: string | undefined): T {
  const parsed = safeParse(schema, value);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((issue) =>
    issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)',
  );
  throw new ResponseError(status, 'invalid-shape', requestId, issues);
}
