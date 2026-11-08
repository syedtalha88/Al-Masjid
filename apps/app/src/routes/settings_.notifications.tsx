import { createFileRoute } from '@tanstack/react-router';

import { NotificationsScreen } from '../features/settings/NotificationsScreen.tsx';

/** Settings → Notifications: status, on/off, mute per masjid (07 A15 §3, PHASE_04 T4.2). */
export const Route = createFileRoute('/settings_/notifications')({
  component: NotificationsScreen,
});
