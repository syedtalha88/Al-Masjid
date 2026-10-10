import { I18nProvider } from '@mc/i18n/react';
import { MotionProvider } from '@mc/ui/motion';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';

import { RoutePending } from './RoutePending.tsx';
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

/**
 * Root providers: motion (lazy features, reduced/lite prefs) → i18n (locale already applied to `<html lang dir>` by `/boot.js`; the first namespaces load
 * as one small JSON chunk) → TanStack Query → TanStack Router (owns error boundaries and Suspense).
 */
export function AppProviders() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createAppRouter(queryClient));
  return (
    <MotionProvider>
      <I18nProvider fallback={<RoutePending />}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nProvider>
    </MotionProvider>
  );
}
