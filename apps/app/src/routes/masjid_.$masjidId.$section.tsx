import { useTranslation } from '@mc/i18n/react';
import { createFileRoute } from '@tanstack/react-router';

import { PlaceholderScreen } from '../app/PlaceholderScreen.tsx';

export const Route = createFileRoute('/masjid_/$masjidId/$section')({
  component: MasjidSection,
});

/** A masjid's later sections (campaigns, chanda, bayans — Phases 5/6); announcements, hadith and duas have their own routes. */
function MasjidSection() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('home.updates')} />;
}
