import { createFileRoute } from '@tanstack/react-router';

import { TermsScreen } from '../features/settings/LegalScreens.tsx';

/** Settings → About → Terms of use (legal reader, 05 §10, PHASE_08 T8.6). */
export const Route = createFileRoute('/settings_/terms')({
  component: TermsScreen,
});
