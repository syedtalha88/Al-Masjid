import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { type Clock, systemClock } from '@mc/shared/clock';
import express, { type Express, type Router } from 'express';
import type { Logger } from 'pino';

import { requireAdminOrigin } from './auth/csrf.ts';
import { type Authenticate, installAuthenticator } from './auth/session.ts';
import { jsonBody } from './http/body.ts';
import type { TrustedProxyMode } from './http/client-ip.ts';
import { mountRoutes, type RouteDefinition } from './http/define-route.ts';
import { errorMapper, type ErrorReporter, notFound } from './http/errors.ts';
import { rejectPreflight } from './http/no-cors.ts';
import { installRateLimiter, type RateLimiter } from './http/rate-limit.ts';
import { requestId } from './http/request-id.ts';
import { requestLogger } from './http/request-logger.ts';
import { securityHeaders } from './http/security-headers.ts';
import { type HealthProbes, healthRoute } from './routes/health.ts';

export interface AppDependencies {
  readonly logger: Logger;
  /** Build release (git SHA in images, `dev` locally). */
  readonly release: string;
  readonly trustedProxyMode: TrustedProxyMode;
  /** Extra routes (tests, and later phases' feature routers). */
  readonly routes?: readonly RouteDefinition[];
  /** Time source for services and jobs (default: the real clock; a ShiftableClock in test-hook mode). */
  readonly clock?: Clock;
  /**
   * E2E test hooks (`@mc/api/test-hooks`), only ever passed by the entrypoints in test-hook mode. Mounted
   * under the prefix but never registered in OpenAPI, so they cannot appear in the published contract.
   */
  readonly testRoutes?: readonly RouteDefinition[];
  /** Unexpected errors (500s) go here as well as to the log — Sentry when configured (T0.13). */
  readonly reportError?: ErrorReporter;
  /** The process's rate limiter (Redis in the entrypoints, memory in tests); routes with limits need it (T1.6). */
  readonly rateLimiter?: RateLimiter;
  /** MongoDB + Redis pings for `/health` (the entrypoints always pass both). */
  readonly health?: Partial<HealthProbes>;
  /** Session authentication (api-admin); routes with `auth` other than `none` need it (T1.8). */
  readonly authenticate?: Authenticate;
  /** api-admin: `ADMIN_ORIGIN` for the Origin/CSRF guard — without it every unsafe request is refused. */
  readonly adminOrigin?: string;
}

export interface CreatedApp {
  readonly app: Express;
  /** OpenAPI registry with every mounted route (for `openapi.json`). */
  readonly registry: OpenAPIRegistry;
}

/** API mount points per process (01 §2). */
export const PUBLIC_API_PREFIX = '/api/v1';
export const ADMIN_API_PREFIX = '/api/admin';

/** Express settings shared by both processes (03 §0 "App settings"). */
function createBaseApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple'); // no nested query objects → no `?a[$ne]=1` operator injection
  // Exactly one trusted hop: Caddy. The real client IP comes from CF-Connecting-IP (http/client-ip.ts).
  app.set('trust proxy', 1);
  app.set('strict routing', true);
  app.set('case sensitive routing', true);
  app.set('etag', false);
  return app;
}

const newRouter = (): Router => express.Router({ strict: true, caseSensitive: true });

function assemble(
  service: 'api-public' | 'api-admin',
  prefix: string,
  {
    logger,
    release,
    trustedProxyMode,
    routes = [],
    clock = systemClock,
    testRoutes = [],
    reportError,
    rateLimiter,
    health,
    authenticate,
    adminOrigin,
  }: AppDependencies,
  noindex: boolean,
): CreatedApp {
  const app = createBaseApp();
  app.locals['clock'] = clock; // services read it from Phase 1 on
  installRateLimiter(app.locals, rateLimiter, trustedProxyMode);
  installAuthenticator(app.locals, authenticate);
  const registry = new OpenAPIRegistry();
  const router = newRouter();
  mountRoutes(router, prefix, [healthRoute(service, release, health), ...routes], registry);
  if (testRoutes.length > 0) {
    mountRoutes(router, prefix, testRoutes); // no registry: never in openapi.json
    logger.warn({ service, routes: testRoutes.length }, 'TEST HOOKS ENABLED (APP_ENV=local, NODE_ENV=test)');
  }

  app.use(requestId()); // 1
  app.use(requestLogger(logger));
  app.use(securityHeaders({ noindex })); // 2
  app.use(rejectPreflight());
  app.use(jsonBody()); // 3
  if (service === 'api-admin') app.use(requireAdminOrigin(adminOrigin)); // 4
  // 5 (auth), 6 (rate limit) and 7 (validation) run per route in defineRoute.
  app.use(prefix, router); // 8
  app.use(notFound()); // 9
  app.use(errorMapper(logger, reportError)); // 10
  return { app, registry };
}

/**
 * Builds the `api-public` Express app (`app.<domain>/api/v1/*`). Cookie-less, device auth (Phase 1).
 *
 * @returns the app and its OpenAPI registry. The caller owns the HTTP server (http/server.ts).
 */
export function createPublicApp(deps: AppDependencies): CreatedApp {
  return assemble('api-public', PUBLIC_API_PREFIX, deps, false);
}

/**
 * Builds the `api-admin` Express app (`admin.<domain>/api/admin/*`; `/api/super/*` and `/api/hooks/*`
 * routers are added in Phase 1/6). Every response carries `X-Robots-Tag: noindex, nofollow`.
 */
export function createAdminApp(deps: AppDependencies): CreatedApp {
  return assemble('api-admin', ADMIN_API_PREFIX, deps, true);
}
