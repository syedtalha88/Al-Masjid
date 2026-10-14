// Browser error reporting (01 §10, DECISIONS #17, #35; PHASE_00 T0.13). Sentry is optional: without a DSN nothing
// is installed and nothing is downloaded. With a DSN, errors and CSP / Trusted Types violations are buffered from
// the start, and Sentry (./sentry.ts) is loaded lazily when the browser is idle — so it costs no initial JS
// (PROGRESS F23). Every event passes `dataCollection` (all off) and our scrubber (no user, no query strings, no
// emails/phones/ids/tokens — CLAUDE.md §2.1). No session tracking, no performance tracing in the browser.
import type { SentryApi } from './sentry.ts';

export interface ErrorReportingOptions {
  /** `VITE_PUBLIC_SENTRY_DSN`; empty or undefined = reporting off. */
  readonly dsn: string | undefined;
  readonly app: 'app' | 'admin';
}

type Pending =
  { readonly kind: 'error'; readonly error: unknown } | { readonly kind: 'message'; readonly text: string };

const MAX_PENDING = 20;
let started = false;
let sentry: SentryApi | undefined;
const pending: Pending[] = [];

function deliver(item: Pending): void {
  if (sentry === undefined) {
    if (pending.length < MAX_PENDING) pending.push(item);
    return;
  }
  if (item.kind === 'error') sentry.captureException(item.error);
  else sentry.captureMessage(item.text, 'warning');
}

/** The release id stamped into index.html at build time (`<meta name="mc-release">`, DECISIONS #46). */
const release = (): string => document.querySelector<HTMLMetaElement>('meta[name="mc-release"]')?.content ?? 'unknown';

/** staging / production / local, from the host name (the client build has no APP_ENV). */
export function environmentFor(hostname: string): 'local' | 'staging' | 'production' {
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1') return 'local';
  return hostname.includes('-staging.') ? 'staging' : 'production';
}

/**
 * Starts error reporting once per page. No-op without a DSN.
 *
 * @returns true when reporting is active (a DSN was given).
 */
export function startErrorReporting({ dsn, app }: ErrorReportingOptions): boolean {
  if (dsn === undefined || dsn === '' || started) return started;
  started = true;

  // Until the SDK is loaded our own listeners buffer what happens; afterwards Sentry's global handlers take over.
  const onError = (event: ErrorEvent) => {
    deliver({ kind: 'error', error: event.error ?? event.message });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    deliver({ kind: 'error', error: event.reason });
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  // CSP and Trusted Types blocks (04 §7, DECISIONS #50): a message without page content, only the directive.
  document.addEventListener('securitypolicyviolation', (event) => {
    deliver({ kind: 'message', text: `CSP: ${event.effectiveDirective} blocked ${event.blockedURI || 'inline'}` });
  });

  const load = () => {
    void import('./sentry.ts')
      .then(({ initSentry }) => {
        const api = initSentry({ dsn, release: release(), environment: environmentFor(location.hostname), app });
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onRejection);
        sentry = api;
        for (const item of pending.splice(0)) deliver(item);
      })
      .catch(() => undefined); // offline or blocked: reporting stays off for this page
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(load, { timeout: 5000 });
  else setTimeout(load, 2000);
  return true;
}

/** Reports an error caught by the app (route error boundary, failed background work). No-op when off. */
export function reportError(error: unknown): void {
  if (started) deliver({ kind: 'error', error });
}
