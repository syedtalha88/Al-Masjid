import type { ErrorComponentProps } from '@tanstack/react-router';

/**
 * Route-level error boundary. Never shows raw error text (CLAUDE.md §6 UI): a friendly message + retry.
 * Copy is temporary English until i18n lands in T0.7 (PROGRESS follow-up F4); styling arrives with the
 * design tokens in T0.6 and the EmptyState component in T0.10.
 */
export function RouteError({ reset }: ErrorComponentProps) {
  return (
    <div role="alert">
      <p>Something went wrong. Please try again.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
