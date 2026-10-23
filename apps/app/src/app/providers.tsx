import { I18nProvider, initialDocumentLocale } from '@mc/i18n/react';
import { ToastProvider } from '@mc/ui/components';
import { MotionProvider } from '@mc/ui/motion';
import { AppSurfaces } from '@mc/ui/pwa';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';

import { type AppData, createAppData, DataProvider } from '../lib/data.tsx';
import { AppGate } from './AppGate.tsx';
import { RoutePending } from './RoutePending.tsx';
import { createAppRouter } from './router.tsx';

/** Turnstile site key (`VITE_PUBLIC_TURNSTILE_SITE_KEY`, validated at build by parseClientEnv). */
const siteKey = (): string => {
  const value: unknown = import.meta.env['VITE_PUBLIC_TURNSTILE_SITE_KEY'];
  return typeof value === 'string' ? value : '';
};

/** A Turnstile token — the helper loads only when a registration actually happens. */
const turnstileToken = async (): Promise<string> =>
  (await import('../lib/turnstile.ts')).turnstileTokenSource(siteKey())();

/**
 * Root providers: motion (lazy features, reduced/lite prefs) → i18n (locale already applied to `<html lang dir>` by
 * `/boot.js`; the first namespaces load as one small JSON chunk) → data (device store read from IndexedDB, persisted
 * TanStack Query cache, registration/follow sync — T2.3) → toasts → onboarding gate (first launch, T2.4) → TanStack Router (owns error boundaries and
 * Suspense) + the offline banner and update-available toast (AppSurfaces, 07 A17).
 */
export function AppProviders({ data }: { readonly data?: AppData }) {
  const [appData] = useState(() => data ?? createAppData({ locale: initialDocumentLocale(), turnstileToken }));
  const [router] = useState(() => createAppRouter(appData.queryClient));
  const [preload] = useState(() => () => {
    for (const to of ['/', '/masjids', '/updates', '/settings', '/scan'] as const) {
      void router.preloadRoute({ to }).catch(() => undefined);
    }
  });
  return (
    <MotionProvider>
      <I18nProvider fallback={<RoutePending />}>
        <DataProvider data={appData} fallback={<RoutePending />}>
          <ToastProvider>
            <AppGate preload={preload}>
              <RouterProvider router={router} />
            </AppGate>
            <AppSurfaces />
          </ToastProvider>
        </DataProvider>
      </I18nProvider>
    </MotionProvider>
  );
}
