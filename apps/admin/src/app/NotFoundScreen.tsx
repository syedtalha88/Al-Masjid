import { useTranslation } from '@mc/i18n/react';
import { Screen } from '@mc/ui/navigation';

/** Unknown path inside the app (the SPA fallback serves every client route). */
export function NotFoundScreen() {
  const { t } = useTranslation();
  const { t: tErrors } = useTranslation('errors');
  return (
    <Screen title={t('appError.title')}>
      <p className="pt-4 type-body text-text-secondary">{tErrors('NOT_FOUND')}</p>
    </Screen>
  );
}
