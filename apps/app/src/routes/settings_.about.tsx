import { createFileRoute } from '@tanstack/react-router';

import { AboutScreen } from '../features/settings/LegalScreens.tsx';

/** Settings → About (07 A15). */
export const Route = createFileRoute('/settings_/about')({
  component: AboutScreen,
});
