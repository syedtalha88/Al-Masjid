import { useTranslation } from '@mc/i18n/react';
import {
  HomeIcon,
  MasjidsIcon,
  type NavConfig,
  type NavigatorApi,
  SettingsIcon,
  StackNavigator,
  TabBar,
  tanstackAdapter,
  UpdatesIcon,
} from '@mc/ui/navigation';
import { useRouter } from '@tanstack/react-router';
import { useMemo } from 'react';

import { NotFoundScreen } from './NotFoundScreen.tsx';
import { RouteError } from './RouteError.tsx';
import { RoutePending } from './RoutePending.tsx';

/** Musalli app navigation (07 Navigation map): four tab roots + the Scan modal. */
export const NAV_CONFIG: NavConfig = {
  tabs: [
    { id: 'home', path: '/' },
    { id: 'masjids', path: '/masjids' },
    { id: 'updates', path: '/updates' },
    { id: 'settings', path: '/settings' },
  ],
  modalPaths: ['/scan'],
};

/** Root of the musalli app: the stack navigator renders every screen; the router owns URLs and history. */
export function AppNavigator() {
  const router = useRouter();
  const adapter = useMemo(() => tanstackAdapter(router), [router]);
  return (
    <StackNavigator
      adapter={adapter}
      config={NAV_CONFIG}
      pendingFallback={<RoutePending />}
      errorFallback={({ reset }) => <RouteError reset={reset} />}
      notFound={NotFoundScreen}
      tabBar={MusalliTabBar}
    />
  );
}

/** Home · My Masjids · [Scan] · Updates · Settings (06 §6). */
function MusalliTabBar({ api }: { readonly api: NavigatorApi }) {
  const { t } = useTranslation();
  return (
    <TabBar
      api={api}
      label={t('tabs.label')}
      start={[
        { id: 'home', label: t('tabs.home'), Icon: HomeIcon },
        { id: 'masjids', label: t('tabs.myMasjids'), Icon: MasjidsIcon },
      ]}
      end={[
        { id: 'updates', label: t('tabs.updates'), Icon: UpdatesIcon },
        { id: 'settings', label: t('tabs.settings'), Icon: SettingsIcon },
      ]}
      scan={{ label: t('tabs.scan'), href: '/scan' }}
    />
  );
}
