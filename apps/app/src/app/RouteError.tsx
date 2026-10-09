import { useTranslation } from '@mc/i18n/react';
import type { ErrorComponentProps } from '@tanstack/react-router';

/**
 * Route-level error boundary. Never shows raw error text (CLAUDE.md §6 UI): a friendly, translated message +
 * retry. Styling arrives with the design tokens in T0.6 and the EmptyState component in T0.10.
 */
export function RouteError({ reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  return (
    <div role="alert">
      <h1>{t('appError.title')}</h1>
      <p>{t('appError.body')}</p>
      <button type="button" onClick={reset}>
        {t('appError.retry')}
      </button>
    </div>
  );
}
