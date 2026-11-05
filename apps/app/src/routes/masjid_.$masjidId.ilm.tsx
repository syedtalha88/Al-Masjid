import { createFileRoute } from '@tanstack/react-router';

import { IlmScreen } from '../features/content/IlmScreen.tsx';

/** A21 "Ask the masjid" — Ilm contacts of one masjid (T3.16). */
export const Route = createFileRoute('/masjid_/$masjidId/ilm')({
  component: IlmScreen,
});
