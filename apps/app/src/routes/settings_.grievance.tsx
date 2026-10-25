import { createFileRoute } from '@tanstack/react-router';

import { GrievanceScreen } from '../features/settings/LegalScreens.tsx';

/** Settings → Contact & Grievance (05 §3). */
export const Route = createFileRoute('/settings_/grievance')({
  component: GrievanceScreen,
});
