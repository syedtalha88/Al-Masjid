import { useTranslation } from '@mc/i18n/react';
import { createFileRoute } from '@tanstack/react-router';

import { PlaceholderScreen } from '../app/PlaceholderScreen.tsx';

export const Route = createFileRoute('/masjid/$masjidId')({
  component: MasjidDetail,
});

/** A5 Masjid Detail — placeholder until T2.8 (the follow flows already land here). */
function MasjidDetail() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('tabs.myMasjids')} />;
}
