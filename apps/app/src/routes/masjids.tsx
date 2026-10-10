import { useTranslation } from '@mc/i18n/react';
import { createFileRoute } from '@tanstack/react-router';

import { PlaceholderScreen } from '../app/PlaceholderScreen.tsx';

export const Route = createFileRoute('/masjids')({
  component: MyMasjidsTab,
});

/** My Masjids tab root (Phase 0 placeholder). */
function MyMasjidsTab() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('tabs.myMasjids')} />;
}
