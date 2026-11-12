import { createFileRoute } from '@tanstack/react-router';

import { ZakatScreen } from '../features/zakat/ZakatScreen.tsx';

/** Settings → My zakat (07 A24): the phone-only tracker. */
export const Route = createFileRoute('/settings_/zakat')({
  component: ZakatScreen,
});
