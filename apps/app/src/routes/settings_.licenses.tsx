import { createFileRoute } from '@tanstack/react-router';

import { LicensesScreen } from '../features/settings/LicensesScreen.tsx';

/** Settings → About → Licenses (05 §10, PHASE_08 T8.6). */
export const Route = createFileRoute('/settings_/licenses')({
  component: LicensesScreen,
});
