import { useTranslation } from '@mc/i18n/react';
import { BRAND } from '@mc/shared/brand';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: Home,
});

/** Empty Home shell (Phase 0 has no feature screens — PHASE_00 "Out of scope"). */
function Home() {
  const { t } = useTranslation();
  return (
    <div className="px-screen pt-safe">
      <p className="type-footnote text-text-secondary pt-6">{t('home.greeting')}</p>
      <h1 className="type-large-title text-text">{BRAND.name}</h1>
    </div>
  );
}
