// First launch (07 A1): until onboarding is done the app shows it instead of the tabs. Opened from a follow link
// (`/m/:code`, 03 §3) the "add your first masjid" page is skipped and that masjid is followed when onboarding ends
// (07 A1 "auto-follows after onboarding"); the app then lands on Home.
import { useTranslation } from '@mc/i18n/react';
import { useToast } from '@mc/ui/components';
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react';

import type { OnboardingNext } from '../features/onboarding/Onboarding.tsx';
import { useAppData, useDeviceState } from '../lib/data.tsx';
import { RoutePending } from './RoutePending.tsx';

const Onboarding = lazy(() => import('../features/onboarding/Onboarding.tsx'));

/**
 * The follow code of a `/m/:code` URL the app was opened with, if any — only its shape is checked here (letters,
 * digits, one dash); the resolve endpoint normalises and validates it (03 §3).
 */
export function arrivalCode(pathname: string = window.location.pathname): string | null {
  const match = /^\/m\/([0-9A-Za-z]{4}-?[0-9A-Za-z]{4})\/?$/.exec(pathname);
  return match?.[1] ?? null;
}

export interface AppGateProps {
  readonly children: ReactNode;
  /** Loads the screens onboarding leads to while it is showing (online) — the landing is instant and works offline. */
  readonly preload?: () => void;
}

export function AppGate({ children, preload }: AppGateProps) {
  const { onboardedAt } = useDeviceState();
  const data = useAppData();
  const toast = useToast();
  const { t } = useTranslation('onboarding');
  const [code] = useState(() => arrivalCode());
  useEffect(() => {
    if (!onboardedAt) preload?.();
  }, [onboardedAt, preload]);

  if (onboardedAt) return <>{children}</>;

  const onFinished = (next: OnboardingNext) => {
    // The router mounts after this render and reads the replaced URL.
    window.history.replaceState(null, '', next);
    if (!code) return;
    void (async () => {
      try {
        const [masjid, sync] = await Promise.all([data.api.resolve(code), import('../lib/device/sync.ts')]);
        await sync.followLocally(data.store, masjid.id, new Date());
        await sync.syncFollows(data.sync);
        toast.show({ message: t('followed', { name: masjid.name }), tone: 'success' });
      } catch {
        toast.show({ message: t('followFailed') });
      }
    })();
  };

  return (
    <Suspense fallback={<RoutePending />}>
      <Onboarding arrivedWithCode={code !== null} onFinished={onFinished} />
    </Suspense>
  );
}
