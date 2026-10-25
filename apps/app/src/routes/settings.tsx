import { createFileRoute } from '@tanstack/react-router';

import { SettingsScreen } from '../features/settings/SettingsScreen.tsx';

/** A15 Settings tab root. */
export const Route = createFileRoute('/settings')({
  component: SettingsScreen,
});
