import { useTranslation } from '@mc/i18n/react';
import { createFileRoute } from '@tanstack/react-router';

import { PlaceholderScreen } from '../app/PlaceholderScreen.tsx';

export const Route = createFileRoute('/updates')({
  component: UpdatesTab,
});

/** Updates tab root (Phase 0 placeholder). */
function UpdatesTab() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('tabs.updates')} />;
}
