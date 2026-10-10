import { useTranslation } from '@mc/i18n/react';
import type { ErrorComponentProps } from '@tanstack/react-router';

/**
 * Route/screen error state. Never shows raw error text (CLAUDE.md §6 UI): a friendly, translated message +
 * retry. Used by the router and by the navigator's per-screen boundary. Styled with the EmptyState
 * component in T0.10.
 */
export function RouteError({ reset }: Pick<ErrorComponentProps, 'reset'>) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="px-screen pt-6">
      <h2 className="type-headline text-text">{t('appError.title')}</h2>
      <p className="type-body text-text-secondary">{t('appError.body')}</p>
      <button type="button" onClick={reset} className="mt-4 min-h-11 type-subhead-strong text-primary-700">
        {t('appError.retry')}
      </button>
    </div>
  );
}
