import type { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi';
import { type Clock, systemClock } from '@mc/shared/clock';
import type { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';

import { type AuthedDevice, authenticateDevice, type DeviceRouteAuth } from '../auth/device.ts';
import { type AuthedSession, authenticateRequest, type RouteAuth } from '../auth/session.ts';
import { ApiProblem } from './problem.ts';
import { enforceRateLimits, type RateLimitRule } from './rate-limit.ts';
import { getRequestId } from './request-id.ts';
import { findUnsafeKey } from './unsafe-keys.ts';

const EMPTY = z.object({});
type EmptyObject = typeof EMPTY;

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type { RouteAuth };

type Responses = Readonly<Record<number, z.ZodType>>;

/** A handler result: one of the declared statuses with a body matching that status's schema. */
export type RouteResult<R extends Responses> = {
  [S in keyof R & number]: { readonly status: S; readonly body: z.input<R[S]> };
}[keyof R & number];

/** What a handler receives as `auth`: nothing on public routes, the device or the session (with its DB scope). */
export type AuthFor<A extends RouteAuth> = A extends 'none'
  ? undefined
  : A extends 'device'
    ? AuthedDevice
    : A extends 'device_optional'
      ? AuthedDevice | undefined
      : AuthedSession;

const isDeviceAuth = (auth: RouteAuth): auth is DeviceRouteAuth => auth === 'device' || auth === 'device_optional';

/** Redirects (stale content version → current version, 01 §5.2): the body carries the target. */
export const redirectSchema = z.object({ location: z.string() });
const isRedirect = (status: number) => status === 301 || status === 302 || status === 307 || status === 308;

export interface RouteContext<P, Q, B, R extends Responses, A extends RouteAuth = 'none'> {
  readonly auth: AuthFor<A>;
  /** The app's clock (real, or the test-hook clock in e2e). */
  readonly clock: Clock;
  readonly params: P;
  readonly query: Q;
  readonly body: B;
  /** Always set: the request-id middleware runs before every route (03 §0 step 1). */
  readonly requestId: string;
  readonly req: Request;
  readonly res: Response;
  /** Builds the handler result; only declared statuses, with a body matching that status's schema. */
  readonly reply: <S extends keyof R & number>(status: S, body: z.input<R[S]>) => RouteResult<R>;
}

export interface RouteSpec<
  P extends z.ZodObject,
  Q extends z.ZodObject,
  B extends z.ZodType,
  R extends Responses,
  A extends RouteAuth = 'none',
> {
  readonly method: HttpMethod;
  /** Express-style path relative to the router, e.g. `/masjids/:id`. */
  readonly path: string;
  readonly summary: string;
  readonly tags?: readonly string[];
  readonly auth: A;
  /**
   * Masjid admins must accept the current undertaking before any write (T1.10, `UNDERTAKING_REQUIRED`). `exempt`
   * only for what must work before that: accepting it, logging out, ending sessions.
   */
  readonly undertaking?: 'exempt';
  /** Rate-limit rules (03 §2), applied in order after auth and before validation. */
  readonly rateLimit?: readonly RateLimitRule[];
  /** `Cache-Control` for successful responses (01 §5.2), per status when it differs (a redirect vs the 200). Default `no-store`. */
  readonly cacheControl?: string | ((status: number) => string);
  /**
   * Success bodies are JSON unless this says otherwise: `text/csv` sends the (string) body as an attachment with this
   * file name — exports only.
   */
  readonly csvAttachment?: string;
  /** Success bodies are an HTML fragment (string) instead of JSON — the link-preview tags only (03 §3). */
  readonly htmlFragment?: true;
  readonly request?: { readonly params?: P; readonly query?: Q; readonly body?: B };
  readonly responses: R;
  readonly handler: (
    context: RouteContext<z.output<P>, z.output<Q>, z.output<B>, R, A>,
  ) => RouteResult<R> | Promise<RouteResult<R>>;
}

/** `reply(status, body)` — the result object; the mapped-type union is checked by the signature. */
const reply = <R extends Responses>(status: number, body: unknown): RouteResult<R> => {
  const result: { status: number; body: unknown } = { status, body };
  return result as RouteResult<R>; // status/body pairing is enforced by RouteContext['reply']'s signature
};

/** A route ready to be mounted: type-erased so routes with different schemas can share a list. */
export interface RouteDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  readonly openapi: Omit<RouteConfig, 'path'>;
  readonly handle: RequestHandler;
}

/** `.strict()` for objects (unknown keys rejected — R11); other schemas unchanged. */
const strict = (schema: z.ZodType): z.ZodType => (schema instanceof z.ZodObject ? schema.strict() : schema);

function assertSafe(part: string, value: unknown): void {
  const unsafe = findUnsafeKey(value);
  if (unsafe !== null) {
    throw new ApiProblem(400, 'UNSAFE_INPUT', undefined, [{ path: `${part}.${unsafe}`, code: 'unsafe_key' }]);
  }
}

/** Parses one request part; Zod issues are re-rooted at `part` (`body.locale`, `query.cursor`…). */
function parsePart(part: 'params' | 'query' | 'body', schema: z.ZodType, value: unknown): unknown {
  assertSafe(part, value);
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ApiProblem(
    400,
    'VALIDATION_FAILED',
    undefined,
    result.error.issues.map((issue) => ({ path: [part, ...issue.path.map(String)].join('.'), code: issue.code })),
  );
}

const isClock = (value: unknown): value is Clock =>
  typeof value === 'object' && value !== null && typeof (value as { now?: unknown }).now === 'function';
/** The app's clock (`app.locals.clock`, set by the app factory). */
const clockOf = (req: Request): Clock => {
  const value: unknown = req.app.locals['clock'];
  return isClock(value) ? value : systemClock;
};

/** `/masjids/:id` → `/masjids/{id}` for OpenAPI. */
export const toOpenApiPath = (path: string): string => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

/**
 * Declares an HTTP route (03 header, CLAUDE.md §6). The **only** place raw Express routing is allowed
 * (lint rule `mc/no-raw-routes`). The returned definition:
 * 0. authenticates per `auth` (03 §0 step 5) → 401 `SESSION_REQUIRED` / 403 `FORBIDDEN` / 403 `STEP_UP_REQUIRED`;
 *    the handler gets the session and its DB scope as `auth`,
 * 1. applies the route's rate limits — step 6, before validation → 429 `RATE_LIMITED` with `Retry-After`,
 * 2. rejects `$`/`.` keys anywhere in params/query/body (R11),
 * 3. validates params/query/body with strict Zod objects → 400 `VALIDATION_FAILED` with field paths (never the raw
 *    input),
 * 4. calls the handler and validates its body against the declared response schema — undeclared fields
 *    are stripped, so internal fields can't leak; a contract violation is a 500 (logged),
 * 5. sets `Cache-Control` (default `no-store`).
 *
 * @returns a type-erased {@link RouteDefinition} to pass to {@link mountRoutes}.
 */
export function defineRoute<
  P extends z.ZodObject = EmptyObject,
  Q extends z.ZodObject = EmptyObject,
  B extends z.ZodType = z.ZodUndefined,
  R extends Responses = Responses,
  A extends RouteAuth = 'none',
>(spec: RouteSpec<P, Q, B, R, A>): RouteDefinition {
  const paramsSchema = strict(spec.request?.params ?? EMPTY);
  const querySchema = strict(spec.request?.query ?? EMPTY);
  const bodySchema = spec.request?.body ? strict(spec.request.body) : z.undefined();
  const cacheControlOf = (status: number) =>
    typeof spec.cacheControl === 'function' ? spec.cacheControl(status) : (spec.cacheControl ?? 'no-store');

  const rateLimit = spec.rateLimit ?? [];

  const handle: RequestHandler = async (req, res) => {
    const clock = clockOf(req);
    const device = isDeviceAuth(spec.auth) ? await authenticateDevice(req, spec.auth) : undefined;
    const authed = isDeviceAuth(spec.auth) ? undefined : await authenticateRequest(req, spec.auth, clock.now());
    if (
      authed?.session.role === 'masjid_admin' &&
      !authed.session.undertakingCurrent &&
      spec.method !== 'get' &&
      spec.undertaking !== 'exempt'
    ) {
      throw new ApiProblem(403, 'UNDERTAKING_REQUIRED');
    }
    await enforceRateLimits(req, rateLimit, {
      session: authed?.session.sessionId.toHexString(),
      device: device?.deviceId,
    });
    const params = parsePart('params', paramsSchema, req.params) as z.output<P>; // parsed by P's schema
    const query = parsePart('query', querySchema, req.query) as z.output<Q>; // parsed by Q's schema
    const body = parsePart('body', bodySchema, req.body) as z.output<B>; // parsed by B's schema

    // authenticateRequest returns a session exactly for the session modes, authenticateDevice a device for 'device'.
    const auth = (device ?? authed) as AuthFor<A>;
    const result = await spec.handler({
      auth,
      clock,
      params,
      query,
      body,
      requestId: getRequestId(res) ?? 'missing-request-id',
      req,
      res,
      reply,
    });
    const schema = spec.responses[result.status];
    if (schema === undefined)
      throw new Error(
        `Route ${spec.method.toUpperCase()} ${spec.path} returned undeclared status ${String(result.status)}`,
      );
    // A contract violation is a server bug → plain Error (500), never a ZodError (which maps to a 400
    // that would blame the client and expose field paths).
    const parsed = schema.safeParse(result.body);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => issue.path.join('.') || '(root)').join(', ');
      throw new Error(
        `Route ${spec.method.toUpperCase()} ${spec.path} response violates its ${String(result.status)} schema at: ${fields}`,
      );
    }
    const output: unknown = parsed.data;

    res.status(result.status).set('Cache-Control', cacheControlOf(result.status));
    if (result.status === 204) res.end();
    else if (isRedirect(result.status)) {
      const target = redirectSchema.parse(output);
      res.location(target.location).end();
    } else if (spec.csvAttachment !== undefined && typeof output === 'string') {
      res
        .type('text/csv; charset=utf-8')
        .set('Content-Disposition', `attachment; filename="${spec.csvAttachment}"`)
        .send(output);
    } else if (spec.htmlFragment && typeof output === 'string') {
      res.type('text/html; charset=utf-8').send(output);
    } else res.json(output);
  };

  const openapi: Omit<RouteConfig, 'path'> = {
    method: spec.method,
    summary: spec.summary,
    ...(spec.tags ? { tags: [...spec.tags] } : {}),
    request: {
      ...(spec.request?.params ? { params: spec.request.params } : {}),
      ...(spec.request?.query ? { query: spec.request.query } : {}),
      ...(spec.request?.body
        ? { body: { required: true, content: { 'application/json': { schema: spec.request.body } } } }
        : {}),
    },
    responses: Object.fromEntries(
      Object.entries(spec.responses).map(([status, schema]) => [
        status,
        {
          description: `HTTP ${status}`,
          ...(status === '204' || isRedirect(Number(status))
            ? {}
            : {
                content: {
                  [spec.csvAttachment !== undefined
                    ? 'text/csv'
                    : spec.htmlFragment
                      ? 'text/html'
                      : 'application/json']: { schema },
                },
              }),
        },
      ]),
    ),
  };

  return { method: spec.method, path: spec.path, openapi, handle };
}

/**
 * Mounts route definitions on a router and registers them in the OpenAPI registry under `prefix`.
 *
 * @param router - an Express router created with `{ strict: true, caseSensitive: true }`.
 * @param prefix - the router's mount path (e.g. `/api/v1`), used only for the OpenAPI document.
 */
export function mountRoutes(
  router: Router,
  prefix: string,
  routes: readonly RouteDefinition[],
  registry?: OpenAPIRegistry,
): void {
  for (const route of routes) {
    router[route.method](route.path, route.handle);
    registry?.registerPath({ ...route.openapi, path: `${prefix}${toOpenApiPath(route.path)}` });
  }
}
