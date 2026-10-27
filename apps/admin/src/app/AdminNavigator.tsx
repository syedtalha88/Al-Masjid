import { type NavConfig, StackNavigator, tanstackAdapter } from '@mc/ui/navigation';
import { useRouter } from '@tanstack/react-router';
import { useMemo } from 'react';

import { NotFoundScreen } from './NotFoundScreen.tsx';
import { RouteError } from './RouteError.tsx';
import { RoutePending } from './RoutePending.tsx';

/** Admin app: one stack rooted at the admin Home (tiles arrive in Phase 3), same navigation system (08 §5.12). */
export const NAV_CONFIG: NavConfig = { tabs: [{ id: 'home', path: '/' }], modalPaths: [] };

// Stable props: new elements / functions on every render defeat the screen slots' memo (F46, as in the musalli app).
const PENDING = <RoutePending />;
const errorFallback = ({ reset }: { readonly reset: () => void }) => <RouteError reset={reset} />;

export function AdminNavigator() {
  const router = useRouter();
  const adapter = useMemo(() => tanstackAdapter(router), [router]);
  return (
    <StackNavigator
      adapter={adapter}
      config={NAV_CONFIG}
      pendingFallback={PENDING}
      errorFallback={errorFallback}
      notFound={NotFoundScreen}
    />
  );
}
