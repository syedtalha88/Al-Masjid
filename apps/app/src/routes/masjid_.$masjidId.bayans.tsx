import { createFileRoute } from '@tanstack/react-router';

import { BayansScreen } from '../features/content/BayansScreen.tsx';

/** A12 Bayans of one masjid (PHASE_06 T6.3). */
export const Route = createFileRoute('/masjid_/$masjidId/bayans')({
  component: BayansScreen,
});
