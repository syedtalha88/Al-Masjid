import { useTranslation } from '@mc/i18n/react';
import { BRAND } from '@mc/shared/brand';
import { Screen } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: Home,
});

/** Admin Home (Phase 0 placeholder; the tile grid arrives in Phase 3). */
function Home() {
  const { t } = useTranslation();
  return (
    <Screen title={BRAND.adminName}>
      <p className="pt-2 type-footnote text-text-secondary">{t('home.greeting')}</p>
    </Screen>
  );
}
