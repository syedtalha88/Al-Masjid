import { createFileRoute } from '@tanstack/react-router';

import { HadithScreen } from '../features/content/HadithScreen.tsx';

/** A8 Hadith & Quran of one masjid. */
export const Route = createFileRoute('/masjid_/$masjidId/hadith')({
  component: HadithScreen,
});
