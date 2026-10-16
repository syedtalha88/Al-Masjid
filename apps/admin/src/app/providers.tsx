import { I18nProvider } from '@mc/i18n/react';
import { ToastProvider } from '@mc/ui/components';
import { MotionProvider } from '@mc/ui/motion';
import { AppSurfaces } from '@mc/ui/pwa';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';

import { SessionGate } from '../features/auth/components/SessionGate.tsx';
import { handleSessionError } from '../features/auth/hooks/use-session.ts';
import { RoutePending } from './RoutePending.tsx';
import { createAppRouter } from './router.tsx';

const ADMIN_NAMESPACES = ['common', 'errors', 'admin'] as const;

/** Creates the app-wide TanStack Query client (offline persistence is added in Phase 2 — 01 §5.6). */
export function createQueryClient(): QueryClient {
  // A 401 from any request means the session ended (expired, revoked elsewhere): back to Login (T1.10).
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        handleSessionError(client, error);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        handleSessionError(client, error);
      },
    }),
    defaultOptions: {
      queries: { staleTime: 60_000, gcTime: 24 * 60 * 60_000, retry: 2, refetchOnWindowFocus: true },
      mutations: { retry: 0 },
    },
  });
  return client;
}

/**
 * Root providers: motion (lazy features, reduced/lite prefs) → i18n (locale already applied to `<html lang dir>` by `/boot.js`; the first namespaces load
 * as one small JSON chunk) → TanStack Query → toasts → TanStack Router (owns error boundaries and Suspense) + the offline banner and
 * update-available toast (AppSurfaces, 07 A17).
 */
export function AppProviders() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createAppRouter(queryClient));
  return (
    <MotionProvider>
      <I18nProvider fallback={<RoutePending />} namespaces={ADMIN_NAMESPACES}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <SessionGate>
              <RouterProvider router={router} />
            </SessionGate>
            <AppSurfaces />
          </ToastProvider>
        </QueryClientProvider>
      </I18nProvider>
    </MotionProvider>
  );
}
