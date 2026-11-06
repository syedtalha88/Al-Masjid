import { createFileRoute } from '@tanstack/react-router';

import { RuqyahScreen } from '../features/content/RuqyahScreen.tsx';

/** A19 Ruqyah of one masjid (T3.15). */
export const Route = createFileRoute('/masjid_/$masjidId/ruqyah')({
  component: RuqyahScreen,
});
