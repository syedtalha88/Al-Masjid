import { BRAND } from '@mc/shared/brand';
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

import { NotFoundScreen } from '../app/NotFoundScreen.tsx';

/**
 * `/_dev/showcase` — the component showcase (PHASE_00 T0.10), dev builds only. In production builds
 * `import.meta.env.DEV` is false, so the import below is removed and no showcase code ships; the path renders
 * the not-found screen (DECISIONS #45, checked by the build test).
 */
const Showcase = import.meta.env.DEV
  ? lazy(() => import('@mc/ui/showcase').then((module) => ({ default: module.Showcase })))
  : null;

export const Route = createFileRoute('/_dev/showcase')({
  component: ShowcaseScreen,
});

function ShowcaseScreen() {
  return Showcase ? <Showcase appName={BRAND.name} /> : <NotFoundScreen />;
}
