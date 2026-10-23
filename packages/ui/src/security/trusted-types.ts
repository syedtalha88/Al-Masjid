// Trusted Types (04 §7, R10; PHASE_00 T0.5). The CSP sends `require-trusted-types-for 'script'; trusted-types
// default`, so every DOM injection sink (innerHTML, script URLs, eval-like APIs) only accepts values from a
// policy. We render with React (no HTML strings anywhere) and the only legitimate sink is the service-worker
// registration, so the `default` policy allows exactly our own worker scripts and rejects everything else:
// in dev it throws with the sink name (fail loudly while coding); in production it returns nothing, so the
// browser blocks the sink and fires a `securitypolicyviolation` event (reported to Sentry from T0.13).

/** Same-origin script URLs that may be loaded as workers. */
export const ALLOWED_SCRIPT_PATHS: readonly string[] = ['/sw.js'];

/**
 * The only third-party script (04 §11): Cloudflare Turnstile, exact URL, loaded by the musalli app only with a real
 * site key (test keys never load it — DECISIONS #93). The CSP also allows only this host in `script-src`.
 */
export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** The part of the Trusted Types API we use (typed locally: not every TS DOM lib ships it). */
interface PolicyOptions {
  createHTML?: (input: string, ...args: unknown[]) => string | null | undefined;
  createScript?: (input: string, ...args: unknown[]) => string | null | undefined;
  createScriptURL?: (input: string, ...args: unknown[]) => string | null | undefined;
}
interface PolicyFactory {
  createPolicy(name: string, options: PolicyOptions): unknown;
}

export interface TrustedTypesOptions {
  /** Throw on a rejected value (dev) instead of silently blocking it (production). */
  readonly dev: boolean;
  /** Defaults to `globalThis` (tests pass a fake window). */
  readonly scope?: { readonly trustedTypes?: PolicyFactory; readonly location: { readonly href: string } };
}

/** Thrown in dev for a value the default policy rejects. */
export class TrustedTypesViolation extends TypeError {
  override readonly name = 'TrustedTypesViolation';
}

/**
 * Installs the `default` Trusted Types policy. Call once, before any other code runs (first import in main).
 *
 * @returns true when installed; false when the browser has no Trusted Types (CSP then has no TT effect).
 * @throws TrustedTypesViolation (dev only) later, from the sink, when code tries to inject anything else.
 */
export function installTrustedTypes({ dev, scope }: TrustedTypesOptions): boolean {
  // The window, seen through the minimal shape above (boundary: Trusted Types is not in every TS DOM lib).
  const browser = globalThis as unknown as NonNullable<TrustedTypesOptions['scope']>;
  const target = scope ?? browser;
  const factory = target.trustedTypes;
  if (factory === undefined) return false;

  const reject = (kind: string, sink: unknown): null => {
    if (dev) throw new TrustedTypesViolation(`Trusted Types: ${kind} for ${String(sink)} is not allowed`);
    return null; // the browser blocks the sink and reports the violation
  };

  factory.createPolicy('default', {
    createHTML: (_input, _type, sink) => reject('HTML', sink),
    createScript: (_input, _type, sink) => reject('script', sink),
    createScriptURL: (input, _type, sink) => {
      let url: URL;
      try {
        url = new URL(input, target.location.href);
      } catch {
        return reject('script URL', sink);
      }
      if (url.href === TURNSTILE_SCRIPT_URL) return url.href;
      const base = new URL(target.location.href);
      const allowed = url.origin === base.origin && url.search === '' && ALLOWED_SCRIPT_PATHS.includes(url.pathname);
      return allowed ? url.pathname : reject('script URL', sink);
    },
  });
  return true;
}
