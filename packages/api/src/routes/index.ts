// The feature routes of each process — one list used by the entrypoints AND the OpenAPI build, so the committed
// contract always matches what is mounted.
import type { RouteDefinition } from '../http/define-route.ts';
import { type AdminAuthDeps, adminSessionRoutes } from './admin-auth.ts';
import { adminContactRoutes } from './admin-contacts.ts';
import { adminLibraryRoutes } from './admin-library.ts';
import { type AdminMasjidRouteDeps, adminMasjidRoutes } from './admin-masjid.ts';
import { type AdminPasskeyDeps, adminPasskeyRoutes } from './admin-passkeys.ts';
import { adminRuqyahRoutes } from './admin-ruqyah.ts';
import { adminCampaignRoutes } from './campaigns.ts';
import { adminChandaRoutes } from './chanda.ts';
import { linkPreviewRoutes } from './link-preview.ts';
import { adminPaymentRoutes, type PaymentRouteDeps, superPaymentRoutes } from './payments.ts';
import { type PublicRouteDeps, publicRoutes } from './public.ts';
import { type SuperRouteDeps, superRoutes } from './super.ts';
import { superLibraryRoutes } from './super-library.ts';
import { superTemplateRoutes } from './super-templates.ts';

export type AdminRouteDeps = AdminAuthDeps &
  AdminPasskeyDeps &
  SuperRouteDeps &
  PaymentRouteDeps &
  Pick<AdminMasjidRouteDeps, 'media' | 'notifier'>;
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
      ...adminRuqyahRoutes(deps),
      ...adminContactRoutes(deps),
      ...adminPaymentRoutes(deps),
      ...adminCampaignRoutes(deps),
      ...adminChandaRoutes(deps),
    ],
    superRoutes: [
      ...superRoutes(deps),
      ...superLibraryRoutes(deps),
      ...superTemplateRoutes(deps),
      ...superPaymentRoutes(deps),
    ],
  };
}
