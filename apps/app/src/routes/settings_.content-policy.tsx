import { createFileRoute } from '@tanstack/react-router';

import { ContentPolicyScreen } from '../features/settings/LegalScreens.tsx';

/** Settings → About → Content policy (legal reader, 05 §10, PHASE_08 T8.6). */
export const Route = createFileRoute('/settings_/content-policy')({
  component: ContentPolicyScreen,
});
