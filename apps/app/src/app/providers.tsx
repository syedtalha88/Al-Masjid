import { I18nProvider, initialDocumentLocale } from '@mc/i18n/react';
import { ToastProvider } from '@mc/ui/components';
import { MotionProvider } from '@mc/ui/motion';
import { AppSurfaces } from '@mc/ui/pwa';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';

import { type AppData, createAppData, DataProvider } from '../lib/data.tsx';
import { RoutePending } from './RoutePending.tsx';
import { createAppRouter } from './router.tsx';

/** Turnstile tokens arrive with onboarding (T2.4); until then a registration attempt is simply deferred. */
const noTurnstileYet = () => Promise.reject(new Error('turnstile not available yet'));

/**
 * Root providers: motion (lazy features, reduced/lite prefs) → i18n (locale already applied to `<html lang dir>` by
 * `/boot.js`; the first namespaces load as one small JSON chunk) → data (device store read from IndexedDB, persisted
 * TanStack Query cache, registration/follow sync — T2.3) → toasts → TanStack Router (owns error boundaries and
 * Suspense) + the offline banner and update-available toast (AppSurfaces, 07 A17).
 */
export function AppProviders({ data }: { readonly data?: AppData }) {
  const [appData] = useState(
    () => data ?? createAppData({ locale: initialDocumentLocale(), turnstileToken: noTurnstileYet }),
  );
  const [router] = useState(() => createAppRouter(appData.queryClient));
  return (
    <MotionProvider>
      <I18nProvider fallback={<RoutePending />}>
        <DataProvider data={appData} fallback={<RoutePending />}>
          <ToastProvider>
            <RouterProvider router={router} />
            <AppSurfaces />
          </ToastProvider>
        </DataProvider>
      </I18nProvider>
    </MotionProvider>
  );
}
