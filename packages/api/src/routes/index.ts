// The feature routes of each process — one list used by the entrypoints AND the OpenAPI build, so the committed
// contract always matches what is mounted.
import type { RouteDefinition } from '../http/define-route.ts';
import { type AdminAuthDeps, adminSessionRoutes } from './admin-auth.ts';
import { adminLibraryRoutes } from './admin-library.ts';
import { adminMasjidRoutes } from './admin-masjid.ts';
import { type AdminPasskeyDeps, adminPasskeyRoutes } from './admin-passkeys.ts';
import { linkPreviewRoutes } from './link-preview.ts';
import { type PublicRouteDeps, publicRoutes } from './public.ts';
import { type SuperRouteDeps, superRoutes } from './super.ts';
import { superLibraryRoutes } from './super-library.ts';

export type AdminRouteDeps = AdminAuthDeps & AdminPasskeyDeps & SuperRouteDeps;
export type { PublicRouteDeps };

/** api-public feature routes (03 §3, PHASE_02 T2.2). */
export function apiPublicRoutes(deps: PublicRouteDeps & { readonly appOrigin?: string }): RouteDefinition[] {
  return [
    ...publicRoutes(deps),
    ...linkPreviewRoutes({ db: deps.db, ...(deps.appOrigin ? { appOrigin: deps.appOrigin } : {}) }),
  ];
}

/** api-admin feature routes (03 §4) and Super Admin routes (03 §5, mounted under `/api/super`). */
export function adminRoutes(deps: AdminRouteDeps): { routes: RouteDefinition[]; superRoutes: RouteDefinition[] } {
  return {
    routes: [
      ...adminSessionRoutes(deps),
      ...adminPasskeyRoutes(deps),
      ...adminMasjidRoutes(deps),
      ...adminLibraryRoutes(deps),
    ],
    superRoutes: [...superRoutes(deps), ...superLibraryRoutes(deps)],
  };
}
