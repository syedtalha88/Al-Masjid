import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

import type { RouterContext } from '../app/router.tsx';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

/** App shell placeholder; the AppShell + TabBar + StackNavigator replace it in T0.9. */
function RootLayout() {
  return (
    <main>
      <Outlet />
    </main>
  );
}
