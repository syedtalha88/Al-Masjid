import { createFileRoute } from '@tanstack/react-router';

import { MyDataScreen } from '../features/settings/MyDataScreen.tsx';

/** Settings → My data + Clear all data (07 A15, 05 §4). */
export const Route = createFileRoute('/settings_/data')({
  component: MyDataScreen,
});
