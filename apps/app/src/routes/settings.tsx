import { useTranslation } from '@mc/i18n/react';
import { createFileRoute } from '@tanstack/react-router';

import { PlaceholderScreen } from '../app/PlaceholderScreen.tsx';

export const Route = createFileRoute('/settings')({
  component: SettingsTab,
});

/** Settings tab root (Phase 0 placeholder). */
function SettingsTab() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('tabs.settings')} />;
}
