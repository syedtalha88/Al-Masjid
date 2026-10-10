import { createRootRouteWithContext } from '@tanstack/react-router';

import { AdminNavigator } from '../app/AdminNavigator.tsx';
import type { RouterContext } from '../app/router.tsx';

/** The navigator renders every screen itself (no `<Outlet>`), so covered screens keep their content. */
export const Route = createRootRouteWithContext<RouterContext>()({
  component: AdminNavigator,
});
