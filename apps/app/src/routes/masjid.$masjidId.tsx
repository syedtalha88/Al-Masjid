import { createFileRoute } from '@tanstack/react-router';

import { MasjidDetailScreen } from '../features/masjid/MasjidDetailScreen.tsx';

/** A5 Masjid Detail. */
export const Route = createFileRoute('/masjid/$masjidId')({
  component: MasjidDetailScreen,
});
