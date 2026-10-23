// Cloudflare Turnstile tokens for device registration (04 §9, T2.4). With a real site key the explicit-render script is
// loaded once (exact URL allowed by the Trusted Types policy and the CSP) and an invisible/managed widget produces a
// token; it shows itself only when Cloudflare needs an interaction. Cloudflare's TEST site keys never load anything:
// their documented dummy token is accepted by the matching test secrets (local, CI, staging before PROGRESS O8) —
// production refuses test secrets at boot (DECISIONS #59), so a test key can never pass there.
import { TURNSTILE_SCRIPT_URL } from '@mc/ui/security';

/** Cloudflare's test site keys: `1x…` always pass, `2x…` always fail, `3x…` force an interaction (treated as pass). */
const TEST_SITE_KEY = /^([123])x0{20}(AA|AB|BB|FF)$/;
/** The token Cloudflare's test secrets accept. */
export const TURNSTILE_DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const TOKEN_TIMEOUT_MS = 30_000;

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  execute(widget: string): void;
  remove(widget: string): void;
}

let script: Promise<TurnstileApi> | undefined;

function loadScript(): Promise<TurnstileApi> {
  script ??= new Promise<TurnstileApi>((resolve, reject) => {
    const element = document.createElement('script');
    // A plain string: the Trusted Types default policy accepts exactly this URL (04 §7).
    element.src = TURNSTILE_SCRIPT_URL;
    element.async = true;
    element.onload = () => {
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile; // set by Cloudflare's script
      if (api) resolve(api);
      else reject(new Error('turnstile api missing'));
    };
    element.onerror = () => {
      script = undefined;
      reject(new Error('turnstile script failed'));
    };
    document.head.append(element);
  });
  return script;
}

/**
 * A token source for a site key.
 *
 * @returns a function resolving to a fresh single-use token; it rejects when Cloudflare is unreachable, the check
 *   fails or no token arrives within 30 s (the caller defers registration and retries later).
 */
export function turnstileTokenSource(siteKey: string): () => Promise<string> {
  const test = TEST_SITE_KEY.exec(siteKey);
  if (test) {
    return () =>
      test[1] === '2'
        ? Promise.reject(new Error('turnstile test key: always fails'))
        : Promise.resolve(TURNSTILE_DUMMY_TOKEN);
  }
  return async () => {
    const api = await loadScript();
    const container = document.createElement('div');
    container.className = 'mc-turnstile';
    document.body.append(container);
    return new Promise<string>((resolve, reject) => {
      // Set right after render; the callbacks only ever run later.
      const handle: { widget?: string } = {};
      const done = (fn: () => void) => {
        clearTimeout(timer);
        if (handle.widget !== undefined) api.remove(handle.widget);
        container.remove();
        fn();
      };
      const timer = setTimeout(() => {
        done(() => {
          reject(new Error('turnstile timeout'));
        });
      }, TOKEN_TIMEOUT_MS);
      handle.widget = api.render(container, {
        sitekey: siteKey,
        execution: 'execute',
        appearance: 'interaction-only',
        callback: (token: unknown) => {
          done(() => {
            if (typeof token === 'string' && token.length > 0) resolve(token);
            else reject(new Error('turnstile: empty token'));
          });
        },
        'error-callback': () => {
          done(() => {
            reject(new Error('turnstile error'));
          });
        },
      });
      api.execute(handle.widget);
    });
  };
}
