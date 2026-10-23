import { createFileRoute } from '@tanstack/react-router';

import { UpdatesScreen } from '../features/updates/UpdatesScreen.tsx';

/** A13 Updates — tab root. */
export const Route = createFileRoute('/updates')({
  component: UpdatesScreen,
});
