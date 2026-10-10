import { type NavConfig, StackNavigator, tanstackAdapter } from '@mc/ui/navigation';
import { useRouter } from '@tanstack/react-router';
import { useMemo } from 'react';

import { NotFoundScreen } from './NotFoundScreen.tsx';
import { RouteError } from './RouteError.tsx';
import { RoutePending } from './RoutePending.tsx';

/** Admin app: one stack rooted at the admin Home (tiles arrive in Phase 3), same navigation system (08 §5.12). */
export const NAV_CONFIG: NavConfig = { tabs: [{ id: 'home', path: '/' }], modalPaths: [] };

export function AdminNavigator() {
  const router = useRouter();
  const adapter = useMemo(() => tanstackAdapter(router), [router]);
  return (
    <StackNavigator
      adapter={adapter}
      config={NAV_CONFIG}
      pendingFallback={<RoutePending />}
      errorFallback={({ reset }) => <RouteError reset={reset} />}
      notFound={NotFoundScreen}
    />
  );
}
