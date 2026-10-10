import { useTranslation } from '@mc/i18n/react';
import { BRAND } from '@mc/shared/brand';
import { createFileRoute } from '@tanstack/react-router';

import { PlaceholderScreen } from '../app/PlaceholderScreen.tsx';

export const Route = createFileRoute('/')({
  component: Home,
});

/** Home tab root (Phase 0 placeholder; the real Home arrives in Phase 2). */
function Home() {
  const { t } = useTranslation();
  return (
    <PlaceholderScreen title={BRAND.name}>
      <p className="pt-2 type-footnote text-text-secondary">{t('home.greeting')}</p>
    </PlaceholderScreen>
  );
}
