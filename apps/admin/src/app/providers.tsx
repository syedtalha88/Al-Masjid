import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';

import { createAppRouter } from './router.tsx';

/** Creates the app-wide TanStack Query client (offline persistence is added in Phase 2 — 01 §5.6). */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, gcTime: 24 * 60 * 60_000, retry: 2, refetchOnWindowFocus: true },
      mutations: { retry: 0 },
    },
  });
}

/** Root providers: TanStack Query + TanStack Router (the router owns error boundaries and Suspense). */
export function AppProviders() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createAppRouter(queryClient));
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
