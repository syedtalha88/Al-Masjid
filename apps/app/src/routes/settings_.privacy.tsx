import { createFileRoute } from '@tanstack/react-router';

import { PrivacyScreen } from '../features/settings/LegalScreens.tsx';

/** Settings → Privacy Policy (legal reader, 05 §10). */
export const Route = createFileRoute('/settings_/privacy')({
  component: PrivacyScreen,
});
