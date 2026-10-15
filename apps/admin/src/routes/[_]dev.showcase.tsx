import { BRAND } from '@mc/shared/brand';
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

import { NotFoundScreen } from '../app/NotFoundScreen.tsx';

/**
 * `/_dev/showcase` — the component showcase (PHASE_00 T0.10): dev builds, and staging builds made with
 * `VITE_PUBLIC_SHOWCASE=true` (deploy-staging.yml only — DECISIONS #58). Vite replaces both values at build time,
 * so in every other build the import below is removed and no showcase code ships; the path renders the not-found
 * screen (DECISIONS #45, checked by `pnpm check:dist`). Dot access on purpose: Vite only replaces it statically.
 */
const Showcase =
  import.meta.env.DEV || import.meta.env.VITE_PUBLIC_SHOWCASE === 'true'
    ? lazy(() => import('@mc/ui/showcase').then((module) => ({ default: module.Showcase })))
    : null;

export const Route = createFileRoute('/_dev/showcase')({
  component: ShowcaseScreen,
});

function ShowcaseScreen() {
  return Showcase ? <Showcase appName={BRAND.name} /> : <NotFoundScreen />;
}
