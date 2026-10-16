// The feature routes of each process — one list used by the entrypoints AND the OpenAPI build, so the committed
// contract always matches what is mounted.
import type { RouteDefinition } from '../http/define-route.ts';
import { type AdminAuthDeps, adminSessionRoutes } from './admin-auth.ts';

export type AdminRouteDeps = AdminAuthDeps;

/** api-admin feature routes (03 §4). */
export function adminRoutes(deps: AdminRouteDeps): RouteDefinition[] {
  return [...adminSessionRoutes(deps)];
}
