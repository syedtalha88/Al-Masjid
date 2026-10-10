import type { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';

import { routeTree } from '../routeTree.gen.ts';
import { RouteError } from './RouteError.tsx';
import { RoutePending } from './RoutePending.tsx';

export interface RouterContext {
  readonly queryClient: QueryClient;
}

/** Creates the type-safe router from the file-based route tree (src/routes/**). */
export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultErrorComponent: RouteError,
    defaultPendingComponent: RoutePending,
    // Each screen keeps its own scroll position inside the stack navigator (08 §3), not the window.
    scrollRestoration: false,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
