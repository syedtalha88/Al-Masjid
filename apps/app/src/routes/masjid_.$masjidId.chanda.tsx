import { createFileRoute } from '@tanstack/react-router';

import { ChandaScreen } from '../features/chanda/ChandaScreen.tsx';

/** A11 Weekly Chanda of one masjid (PHASE_05 T5.5). */
export const Route = createFileRoute('/masjid_/$masjidId/chanda')({
  component: ChandaScreen,
});
