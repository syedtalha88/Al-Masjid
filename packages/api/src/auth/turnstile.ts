// Cloudflare Turnstile server-side validation (04 §9, 03 §3 `POST /devices`). Verified against Cloudflare's docs on
// 22 Oct 2026: `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` with `secret` + `response` (form or
// JSON); tokens are single-use, ≤ 2048 characters, valid 5 minutes. `remoteip` is optional and never sent — we do not
// handle client IPs (04 §9). Fixed host, 5 s timeout, no redirects (04 §6 outbound rules).

/** Checks one Turnstile token; resolves `true` only for a valid, unused token issued for one of our hostnames. */
export type TurnstileVerifier = (token: string) => Promise<boolean>;

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5000;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * The production verifier.
 *
 * @param input.secret - `TURNSTILE_SECRET` of this process.
 * @param input.hostnames - hostnames the widget may run on (the app origin's host); a token minted elsewhere is
 *   refused. Cloudflare's test secrets answer with `example.com`, so local stacks pass `null` to skip the check.
 * @param input.fetch - injectable for tests.
 * @returns a verifier that never throws: network errors, timeouts and odd answers are a refusal (fail closed).
 */
export function turnstileVerifier(input: {
  readonly secret: string;
  readonly hostnames: readonly string[] | null;
  readonly fetch?: Fetch;
}): TurnstileVerifier {
  const send = input.fetch ?? ((url, init) => fetch(url, init));
  return async (token) => {
    try {
      const response = await send(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: input.secret, response: token }).toString(),
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) return false;
      const answer: unknown = await response.json();
      if (typeof answer !== 'object' || answer === null) return false;
      const { success, hostname } = answer as { success?: unknown; hostname?: unknown }; // checked field by field
      if (success !== true) return false;
      return input.hostnames === null || (typeof hostname === 'string' && input.hostnames.includes(hostname));
    } catch {
      return false;
    }
  };
}
