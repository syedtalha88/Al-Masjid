import { useTranslation } from '@mc/i18n/react';
import { reportError } from '@mc/ui/observability';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { useEffect } from 'react';

/**
 * Route/screen error state. Never shows raw error text (CLAUDE.md §6 UI): a friendly, translated message +
 * retry. Used by the router and by the navigator's per-screen boundary. Styled with the EmptyState
 * component in T0.10.
 */
export function RouteError({ error, reset }: Pick<ErrorComponentProps, 'reset'> & { readonly error?: unknown }) {
  const { t } = useTranslation();
  useEffect(() => {
    // Router-level errors (screens report from their own boundary). To Sentry when configured — T0.13.
    if (error !== undefined) reportError(error);
  }, [error]);
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
