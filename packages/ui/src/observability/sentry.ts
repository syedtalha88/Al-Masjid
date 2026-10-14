// Loaded lazily by errors.ts only when a DSN is configured. Named imports (not `import('@sentry/browser')`) let the
// bundler drop replay, feedback and tracing: a whole-namespace dynamic import pulled ≈ 140 kB gz (T0.13).
import { scrubEvent, SENTRY_DATA_COLLECTION } from '@mc/shared/observability';
import { captureException, captureMessage, init } from '@sentry/browser';

export interface SentryInit {
  readonly dsn: string;
  readonly release: string;
  readonly environment: string;
  readonly app: 'app' | 'admin';
}

/** What errors.ts calls once Sentry is up. */
export interface SentryApi {
  captureException(error: unknown): unknown;
  captureMessage(message: string, level?: 'warning'): unknown;
}

/**
 * Initialises `@sentry/browser` with every privacy switch off and our scrubber on every event and breadcrumb.
 *
 * @returns the capture functions.
 */
export function initSentry({ dsn, release, environment, app }: SentryInit): SentryApi {
  init({
    dsn,
    release,
    environment,
    initialScope: { tags: { app } },
    dataCollection: SENTRY_DATA_COLLECTION,
    sampleRate: 1,
    sendClientReports: false,
    // No release-health session pings: they would send one request per page view for every musalli.
    integrations: (defaults) => defaults.filter((integration) => integration.name !== 'BrowserSession'),
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubEvent(breadcrumb),
  });
  return { captureException, captureMessage };
}
