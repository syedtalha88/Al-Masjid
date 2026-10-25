import { createFileRoute } from '@tanstack/react-router';

import { AnnouncementsScreen } from '../features/content/AnnouncementsScreen.tsx';

/** A7 Announcements of one masjid. */
export const Route = createFileRoute('/masjid_/$masjidId/announcements')({
  component: AnnouncementsScreen,
});
