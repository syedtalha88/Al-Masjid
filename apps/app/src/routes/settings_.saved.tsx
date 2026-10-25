import { createFileRoute } from '@tanstack/react-router';

import { SavedScreen } from '../features/settings/SavedScreen.tsx';

/** Settings → Saved (07 A15). */
export const Route = createFileRoute('/settings_/saved')({
  component: SavedScreen,
});
