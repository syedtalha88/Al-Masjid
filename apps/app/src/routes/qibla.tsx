import { useTranslation } from '@mc/i18n/react';
import { Screen } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';

/** A14 Qibla — full-screen modal from the Home header; the compass arrives in Phase 7 (PROGRESS F18). */
export const Route = createFileRoute('/qibla')({
  component: QiblaModal,
});

function QiblaModal() {
  const { t } = useTranslation();
  return (
    <Screen title={t('home.qibla')}>
      <p className="pt-4 type-body text-text-secondary">{t('placeholder.comingSoon')}</p>
    </Screen>
  );
}
