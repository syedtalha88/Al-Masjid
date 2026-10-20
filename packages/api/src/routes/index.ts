// The feature routes of each process — one list used by the entrypoints AND the OpenAPI build, so the committed
// contract always matches what is mounted.
import type { RouteDefinition } from '../http/define-route.ts';
import { type AdminAuthDeps, adminSessionRoutes } from './admin-auth.ts';
import { type AdminPasskeyDeps, adminPasskeyRoutes } from './admin-passkeys.ts';
import { type SuperRouteDeps, superRoutes } from './super.ts';

export type AdminRouteDeps = AdminAuthDeps & AdminPasskeyDeps & SuperRouteDeps;

/** api-admin feature routes (03 §4) and Super Admin routes (03 §5, mounted under `/api/super`). */
export function adminRoutes(deps: AdminRouteDeps): { routes: RouteDefinition[]; superRoutes: RouteDefinition[] } {
  return { routes: [...adminSessionRoutes(deps), ...adminPasskeyRoutes(deps)], superRoutes: superRoutes(deps) };
}
