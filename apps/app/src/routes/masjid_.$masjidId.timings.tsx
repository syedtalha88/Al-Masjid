import { createFileRoute } from '@tanstack/react-router';

import { TimingsScreen } from '../features/masjid/TimingsScreen.tsx';

/** A6 Prayer Timings. */
export const Route = createFileRoute('/masjid_/$masjidId/timings')({
  component: TimingsScreen,
});
