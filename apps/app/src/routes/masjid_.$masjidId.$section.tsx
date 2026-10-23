import { useTranslation } from '@mc/i18n/react';
import { createFileRoute } from '@tanstack/react-router';

import { PlaceholderScreen } from '../app/PlaceholderScreen.tsx';

export const Route = createFileRoute('/masjid_/$masjidId/$section')({
  component: MasjidSection,
});

/** A masjid's section list (announcements, hadith, duas, campaigns, chanda, bayans) — placeholder until T2.11. */
function MasjidSection() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('home.updates')} />;
}
