import { createFileRoute } from '@tanstack/react-router';

import { AdhkarScreen } from '../features/content/AdhkarScreen.tsx';

/** A20 Adhkar after salah of one masjid (T3.14). */
export const Route = createFileRoute('/masjid_/$masjidId/adhkar')({
  component: AdhkarScreen,
});
