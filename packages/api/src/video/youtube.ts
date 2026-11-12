// YouTube lookups for bayan videos (DECISIONS #39, 04 §6 outbound requests, PHASE_06 T6.1). The only two requests the
// server ever makes for a video, both to fixed hosts with URLs built from a validated id (never the pasted link):
// - oEmbed `https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=<id>` → the title. Verified
//   13 Nov 2026: public and unlisted videos answer 200 JSON (`title`, `author_name`, `thumbnail_url` …); an id that
//   does not exist answers 404. Private videos and videos whose owner turned embedding off answer an error too (401 /
//   403 are commonly reported) — every non-200 answer below 500 means "this video cannot play in the app".
// - the thumbnail `https://i.ytimg.com/vi/<id>/hqdefault.jpg` (480 × 360 JPEG; 404 when there is none) — copied once,
//   sanitized by the image pipeline and stored like any photo, so followers' phones never contact Google before Play.
// 5 s timeout, no redirects at all, response size limits, fail closed.
import { YOUTUBE_ID_PATTERN } from '@mc/domain/youtube';

/** What the admin's preview needs. */
export interface VideoDetails {
  /** YouTube's title, cleaned and ≤ {@link VIDEO_TITLE_MAX} characters (the admin may edit it). */
  readonly title: string;
  /** The thumbnail JPEG as YouTube serves it (not yet sanitized), or `null` when YouTube has none. */
  readonly thumbnail: Buffer | null;
}

export interface VideoLookup {
  /**
   * Looks a video up.
   *
   * @param id - a video id matching `YOUTUBE_ID_PATTERN` (from `parseYouTubeLink`).
   * @returns the details, or `null` when the video cannot be played in the app (private, deleted, embedding off).
   * @throws VideoLookupFailed when YouTube could not be asked (network, timeout, 5xx, odd answer) — try again later.
   */
  lookup(id: string): Promise<VideoDetails | null>;
}

/** YouTube could not be asked (the API answers 503 — retry later); never "unavailable". */
export class VideoLookupFailed extends Error {
  constructor(reason: string) {
    super(`video lookup failed: ${reason}`);
  }
}

export const OEMBED_URL = 'https://www.youtube.com/oembed';
export const THUMBNAIL_HOST = 'https://i.ytimg.com';
/** Longest title kept (the bayan title field's limit — 03 Videos). */
export const VIDEO_TITLE_MAX = 120;
const TIMEOUT_MS = 5000;
const OEMBED_MAX_BYTES = 64 * 1024;
const THUMBNAIL_MAX_BYTES = 512 * 1024;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** Control characters and bidi overrides / isolates out, white space collapsed, cut to {@link VIDEO_TITLE_MAX}. */
export function cleanVideoTitle(title: string): string {
  return Array.from(
    title
      .replace(/[\p{Cc}‪-‮⁦-⁩]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim(),
  )
    .slice(0, VIDEO_TITLE_MAX)
    .join('')
    .trim();
}

/** The body, refused beyond `max` bytes (by the declared length first, then by what arrived). */
async function limitedBody(response: Response, max: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > max) throw new VideoLookupFailed('response too large');
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > max) throw new VideoLookupFailed('response too large');
  return body;
}

/**
 * The real adapter (api-admin).
 *
 * @param input.fetch - injectable for tests; the global `fetch` otherwise.
 */
export function youTubeLookup(input: { readonly fetch?: Fetch } = {}): VideoLookup {
  const send = input.fetch ?? ((url, init) => fetch(url, init));
  const get = async (url: string, accept: string) => {
    try {
      return await send(url, {
        method: 'GET',
        headers: { Accept: accept },
        redirect: 'error', // 04 §6: never follow a redirect anywhere
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new VideoLookupFailed('network or timeout');
    }
  };

  return {
    async lookup(id) {
      if (!YOUTUBE_ID_PATTERN.test(id)) throw new RangeError('youTubeLookup(): not a YouTube video id');
      const watch = `https://www.youtube.com/watch?v=${id}`;
      const oembed = await get(`${OEMBED_URL}?format=json&url=${encodeURIComponent(watch)}`, 'application/json');
      // Throttled or timed out at YouTube: try again — never "this video is private" (#165 L4).
      if (oembed.status === 408 || oembed.status === 429)
        throw new VideoLookupFailed(`oembed ${String(oembed.status)}`);
      if (oembed.status >= 400 && oembed.status < 500) return null; // private, deleted, embedding off, unknown
      if (oembed.status !== 200) throw new VideoLookupFailed(`oembed ${String(oembed.status)}`);
      let answer: unknown;
      try {
        answer = JSON.parse((await limitedBody(oembed, OEMBED_MAX_BYTES)).toString('utf8'));
      } catch (error) {
        if (error instanceof VideoLookupFailed) throw error;
        throw new VideoLookupFailed('oembed not JSON');
      }
      const raw = typeof answer === 'object' && answer !== null ? (answer as { title?: unknown }).title : undefined;
      if (typeof raw !== 'string') throw new VideoLookupFailed('oembed without a title');
      const title = cleanVideoTitle(raw);

      const image = await get(`${THUMBNAIL_HOST}/vi/${id}/hqdefault.jpg`, 'image/jpeg');
      if (image.status === 404) return { title, thumbnail: null };
      if (image.status !== 200) throw new VideoLookupFailed(`thumbnail ${String(image.status)}`);
      const type = image.headers.get('content-type') ?? '';
      if (!type.startsWith('image/jpeg')) throw new VideoLookupFailed('thumbnail not a JPEG');
      try {
        return { title, thumbnail: await limitedBody(image, THUMBNAIL_MAX_BYTES) };
      } catch (error) {
        if (error instanceof VideoLookupFailed) throw error;
        throw new VideoLookupFailed('thumbnail body'); // a timeout while reading → 503, not 500 (#165 L5)
      }
    },
  };
}

/** Ids the mock answers as "cannot play in the app" (private, deleted, embedding off) — for tests and e2e. */
export const MOCK_UNAVAILABLE_IDS = ['privateVid1', 'deletedVid1', 'noEmbedVid1'] as const;
/** An id the mock answers as "YouTube could not be asked". */
export const MOCK_FAILING_ID = 'failingVid1';

/**
 * The mock adapter (local stack, tests, e2e — no network): every id is a playable "Test bayan <id>" with the given
 * thumbnail, except {@link MOCK_UNAVAILABLE_IDS} (`null`) and {@link MOCK_FAILING_ID} (throws).
 *
 * @param thumbnail - the JPEG every playable video gets (`null` → none).
 */
export function mockVideoLookup(thumbnail: Buffer | null): VideoLookup {
  const unavailable: ReadonlySet<string> = new Set(MOCK_UNAVAILABLE_IDS);
  return {
    lookup(id) {
      if (!YOUTUBE_ID_PATTERN.test(id)) return Promise.reject(new RangeError('mockVideoLookup(): not a video id'));
      if (id === MOCK_FAILING_ID) return Promise.reject(new VideoLookupFailed('mock'));
      if (unavailable.has(id)) return Promise.resolve(null);
      return Promise.resolve({ title: `Test bayan ${id}`, thumbnail });
    },
  };
}

/**
 * The adapter env `VIDEO_LOOKUP` names (api-admin): `youtube` (required outside local) or `mock` (local default — no
 * network; every video gets a generated grey 480 × 360 thumbnail).
 */
export async function videoLookupFromEnv(env: { readonly VIDEO_LOOKUP: 'youtube' | 'mock' }): Promise<VideoLookup> {
  if (env.VIDEO_LOOKUP === 'youtube') return youTubeLookup();
  const { default: sharp } = await import('sharp');
  const thumbnail = await sharp({
    create: { width: 480, height: 360, channels: 3, background: { r: 96, g: 120, b: 112 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
  return mockVideoLookup(thumbnail);
}
