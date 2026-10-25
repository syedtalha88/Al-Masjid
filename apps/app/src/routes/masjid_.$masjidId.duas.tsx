import { createFileRoute } from '@tanstack/react-router';

import { DuasScreen } from '../features/content/DuasScreen.tsx';

/** A9 Dua Requests of one masjid. */
export const Route = createFileRoute('/masjid_/$masjidId/duas')({
  component: DuasScreen,
});
