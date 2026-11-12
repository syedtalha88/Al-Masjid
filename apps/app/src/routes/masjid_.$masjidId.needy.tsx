import { createFileRoute } from '@tanstack/react-router';

import { NeedyScreen } from '../features/needy/NeedyScreen.tsx';

/** A23 Help the needy of one masjid (T5.8). */
export const Route = createFileRoute('/masjid_/$masjidId/needy')({
  component: NeedyScreen,
});
