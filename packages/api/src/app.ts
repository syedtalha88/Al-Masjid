import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import express, { type Express, type Router } from 'express';
import type { Logger } from 'pino';

import { jsonBody } from './http/body.ts';
import type { TrustedProxyMode } from './http/client-ip.ts';
import { mountRoutes, type RouteDefinition } from './http/define-route.ts';
import { errorMapper, notFound } from './http/errors.ts';
import { rejectPreflight } from './http/no-cors.ts';
import { requestId } from './http/request-id.ts';
import { requestLogger } from './http/request-logger.ts';
import { securityHeaders } from './http/security-headers.ts';
import { healthRoute } from './routes/health.ts';

export interface AppDependencies {
  readonly logger: Logger;
  /** Build release (git SHA in images, `dev` locally). */
  readonly release: string;
  readonly trustedProxyMode: TrustedProxyMode;
  /** Extra routes (tests, and later phases' feature routers). */
  readonly routes?: readonly RouteDefinition[];
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
  { logger, release, routes = [] }: AppDependencies,
  noindex: boolean,
): CreatedApp {
  const app = createBaseApp();
  const registry = new OpenAPIRegistry();
  const router = newRouter();
  mountRoutes(router, prefix, [healthRoute(service, release), ...routes], registry);

  app.use(requestId()); // 1
  app.use(requestLogger(logger));
  app.use(securityHeaders({ noindex })); // 2
  app.use(rejectPreflight());
  app.use(jsonBody()); // 3
  // 4 (origin/CSRF, admin), 5 (auth), 6 (rate limit) arrive in Phase 1; 7 (validation) is in defineRoute.
  app.use(prefix, router); // 8
  app.use(notFound()); // 9
  app.use(errorMapper(logger)); // 10
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
