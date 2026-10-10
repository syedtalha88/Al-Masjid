import { useTranslation } from '@mc/i18n/react';
import { Screen } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/scan')({
  component: ScanModal,
});

/** Scan modal (Phase 0 placeholder; the QR scanner arrives in Phase 2). */
function ScanModal() {
  const { t } = useTranslation();
  return (
    <Screen title={t('placeholder.scanTitle')}>
      <p className="pt-4 type-body text-text-secondary">{t('placeholder.comingSoon')}</p>
    </Screen>
  );
}
