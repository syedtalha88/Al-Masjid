import type { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';

import { ApiProblem } from './problem.ts';
import { getRequestId } from './request-id.ts';
import { findUnsafeKey } from './unsafe-keys.ts';

const EMPTY = z.object({});
type EmptyObject = typeof EMPTY;

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Auth schemes (03 §1). Only `none` exists before Phase 1 adds device/session/super auth. */
export type RouteAuth = 'none';

type Responses = Readonly<Record<number, z.ZodType>>;

/** A handler result: one of the declared statuses with a body matching that status's schema. */
export type RouteResult<R extends Responses> = {
  [S in keyof R & number]: { readonly status: S; readonly body: z.input<R[S]> };
}[keyof R & number];

export interface RouteContext<P, Q, B, R extends Responses> {
  readonly params: P;
  readonly query: Q;
  readonly body: B;
  readonly requestId: string | undefined;
  readonly req: Request;
  readonly res: Response;
  /** Builds the handler result; only declared statuses, with a body matching that status's schema. */
  readonly reply: <S extends keyof R & number>(status: S, body: z.input<R[S]>) => RouteResult<R>;
}

export interface RouteSpec<P extends z.ZodObject, Q extends z.ZodObject, B extends z.ZodType, R extends Responses> {
  readonly method: HttpMethod;
  /** Express-style path relative to the router, e.g. `/masjids/:id`. */
  readonly path: string;
  readonly summary: string;
  readonly tags?: readonly string[];
  readonly auth: RouteAuth;
  /** `Cache-Control` for successful responses (01 §5.2). Default `no-store`. */
  readonly cacheControl?: string;
  readonly request?: { readonly params?: P; readonly query?: Q; readonly body?: B };
  readonly responses: R;
  readonly handler: (
    context: RouteContext<z.output<P>, z.output<Q>, z.output<B>, R>,
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

/** `/masjids/:id` → `/masjids/{id}` for OpenAPI. */
export const toOpenApiPath = (path: string): string => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

/**
 * Declares an HTTP route (03 header, CLAUDE.md §6). The **only** place raw Express routing is allowed
 * (lint rule `mc/no-raw-routes`). The returned definition:
 * 1. rejects `$`/`.` keys anywhere in params/query/body (R11),
 * 2. validates params/query/body with strict Zod objects → 400 `VALIDATION_FAILED` with field paths,
 * 3. (Phase 1) applies auth + rate limit per `auth`,
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
>(spec: RouteSpec<P, Q, B, R>): RouteDefinition {
  const paramsSchema = strict(spec.request?.params ?? EMPTY);
  const querySchema = strict(spec.request?.query ?? EMPTY);
  const bodySchema = spec.request?.body ? strict(spec.request.body) : z.undefined();
  const cacheControl = spec.cacheControl ?? 'no-store';

  const handle: RequestHandler = async (req, res) => {
    const params = parsePart('params', paramsSchema, req.params) as z.output<P>; // parsed by P's schema
    const query = parsePart('query', querySchema, req.query) as z.output<Q>; // parsed by Q's schema
    const body = parsePart('body', bodySchema, req.body) as z.output<B>; // parsed by B's schema

    const result = await spec.handler({ params, query, body, requestId: getRequestId(res), req, res, reply });
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

    res.status(result.status).set('Cache-Control', cacheControl);
    if (result.status === 204) res.end();
    else res.json(output);
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
        { description: `HTTP ${status}`, ...(status === '204' ? {} : { content: { 'application/json': { schema } } }) },
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
