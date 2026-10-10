import { createRootRouteWithContext } from '@tanstack/react-router';

import { AppNavigator } from '../app/AppNavigator.tsx';
import type { RouterContext } from '../app/router.tsx';

/** The navigator renders every screen itself (no `<Outlet>`), so covered screens keep their content. */
export const Route = createRootRouteWithContext<RouterContext>()({
  component: AppNavigator,
});
