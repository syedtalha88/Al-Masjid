// Server error reporting (01 §10, DECISIONS #17, #35; PHASE_00 T0.13). Off unless SENTRY_DSN is set. Every event,
// breadcrumb and span passes `dataCollection` (all off) and the shared scrubber, so no request bodies, headers,
// cookies, query strings, ids, emails, phone numbers or tokens leave the process (CLAUDE.md §2.1, §6 "never log").
// `@sentry/node` stays outside the bundle (a dependency of this package, like BullMQ — DECISIONS #34).
import { scrubEvent, SENTRY_DATA_COLLECTION } from '@mc/shared/observability';
import * as Sentry from '@sentry/node';

export interface ServerSentryOptions {
  readonly dsn: string | undefined;
  readonly release: string;
  readonly environment: string;
  readonly process: 'api-public' | 'api-admin' | 'worker' | 'migrate';
}

export interface ServerSentry {
  /** Reports an unexpected error (the API's 500s, failed jobs) with non-identifying context. */
  readonly report: (error: unknown, context?: { readonly requestId?: string | undefined }) => void;
  /** Sends what is queued; call during graceful shutdown. */
  readonly flush: () => Promise<void>;
}

/** 01 §10: errors 100 %, traces 5 %. */
export const TRACES_SAMPLE_RATE = 0.05;

/** Exact options passed to `Sentry.init` (exported for the unit test). */
export function sentryInitOptions({ dsn, release, environment, process }: ServerSentryOptions & { dsn: string }) {
  return {
    dsn,
    release,
    environment,
    // The container hostname is meaningless; the process name groups events usefully.
    serverName: process,
    initialScope: { tags: { process } },
    dataCollection: SENTRY_DATA_COLLECTION,
    sampleRate: 1,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    beforeSend: <T extends object>(event: T): T => scrubEvent(event),
    beforeBreadcrumb: <T extends object>(breadcrumb: T): T => scrubEvent(breadcrumb),
    beforeSendSpan: <T extends object>(span: T): T => scrubEvent(span),
  };
}

/**
 * Starts Sentry for one server process.
 *
 * @returns the reporter, or undefined when no DSN is configured (reporting off).
 */
export function startServerSentry(options: ServerSentryOptions): ServerSentry | undefined {
  if (options.dsn === undefined || options.dsn === '') return undefined;
  Sentry.init(sentryInitOptions({ ...options, dsn: options.dsn }));
  return {
    report: (error, context = {}) => {
      Sentry.withScope((scope) => {
        if (context.requestId !== undefined) scope.setTag('request_id', context.requestId);
        Sentry.captureException(error);
      });
    },
    flush: async () => {
      await Sentry.close(2000);
    },
  };
}
