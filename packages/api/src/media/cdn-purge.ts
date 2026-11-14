// CDN purge (01 §5.2, DECISIONS #40, PHASE_06 T6.4): media is cached at Cloudflare for a year (`immutable`), so a file
// deleted from storage is also purged by URL. Verified against Cloudflare's docs on 13 Nov 2026:
// `POST https://api.cloudflare.com/client/v4/zones/<zone>/purge_cache` with `{"files": [<full URLs>]}`, header
// `Authorization: Bearer <token>` (token permission "Cache Purge"), at most 100 URLs per request on every plan
// (Free: 800 URLs / s per account); success = HTTP 200 with `"success": true` (it accepts the request — it does not
// confirm anything was cached). Fixed host, 10 s timeout, no redirects (04 §6).
// Purge by cache tag (PHASE_08 T8.2 takedown), verified 13 Nov 2026: available on every plan (Free included), the same
// endpoint with `{"tags": [...]}`, up to 100 tags per request, one purge type per request; Free allows 5 tag / host /
// prefix requests a minute (bucket 25) — error 1134 when over. Origins tag responses with `Cache-Tag: a, b`
// (comma-separated, case-insensitive, stripped before the visitor).
import { IMAGE_FORMATS, IMAGE_WIDTHS } from './image.ts';

export interface CdnPurger {
  /**
   * Purges these URLs from the CDN.
   *
   * @throws Error when the CDN refused or could not be asked (the job retries; purging twice is harmless).
   */
  purge(urls: readonly string[]): Promise<void>;
  /**
   * Purges every cached response carrying one of these cache tags (`i-<publicId>`, `m-<masjidId>`).
   *
   * @throws Error when the CDN refused or could not be asked (the job retries; purging twice is harmless).
   */
  purgeTags(tags: readonly string[]): Promise<void>;
}

export const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
/** Cloudflare's "max operations per request" for purge by URL (every plan). */
export const PURGE_BATCH = 100;
const TIMEOUT_MS = 10_000;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** The real purger (worker): Cloudflare's purge by URL, 100 URLs per request. */
export function cloudflarePurger(input: {
  readonly token: string;
  readonly zoneId: string;
  readonly fetch?: Fetch;
}): CdnPurger {
  if (!/^[a-f0-9]{32}$/u.test(input.zoneId)) throw new Error('cloudflarePurger: malformed zone id');
  const send = input.fetch ?? ((url, init) => fetch(url, init));
  const endpoint = `${CLOUDFLARE_API}/zones/${input.zoneId}/purge_cache`;
  const request = async (body: { files: readonly string[] } | { tags: readonly string[] }) => {
    const response = await send(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const answer: unknown = await response.json().catch(() => null);
    const ok =
      response.ok &&
      typeof answer === 'object' &&
      answer !== null &&
      (answer as { success?: unknown }).success === true;
    // Status only — never the token or the response body (CLAUDE.md §6 logging).
    if (!ok) throw new Error(`cdn purge refused: HTTP ${String(response.status)}`);
  };
  return {
    async purge(urls) {
      for (let start = 0; start < urls.length; start += PURGE_BATCH) {
        await request({ files: urls.slice(start, start + PURGE_BATCH) });
      }
    },
    async purgeTags(tags) {
      for (let start = 0; start < tags.length; start += PURGE_BATCH) {
        await request({ tags: tags.slice(start, start + PURGE_BATCH) });
      }
    },
  };
}

/** No CDN in front (local): nothing to purge. */
export const noCdnPurger: CdnPurger = { purge: () => Promise.resolve(), purgeTags: () => Promise.resolve() };

/**
 * Every delivery URL of the given media on the media origin (01 §5.4): an image's six named transformations
 * (`/i/<480|960|1440>/<avif|webp>/<key>`) and a voice note's `/a/m4a/<key>`.
 */
export function mediaDeliveryUrls(
  origin: string,
  media: { readonly images: readonly string[]; readonly audio: readonly string[] },
): string[] {
  const base = origin.replace(/\/$/u, '');
  const path = (key: string) =>
    key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  return [
    ...media.images.flatMap((key) =>
      IMAGE_WIDTHS.flatMap((width) =>
        IMAGE_FORMATS.map((format) => `${base}/i/${String(width)}/${format}/${path(key)}`),
      ),
    ),
    ...media.audio.map((key) => `${base}/a/m4a/${path(key)}`),
  ];
}
