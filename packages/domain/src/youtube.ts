// YouTube links for bayan videos (DECISIONS #39, 04 §6, PHASE_06 T6.1). An admin pastes a link from the masjid's own
// channel; we keep only the 11-character video id and an optional start second, and build every YouTube URL ourselves.
// Parsing uses the WHATWG URL parser, `https:` only, an exact host allow-list (no suffix matching), and a fixed set of
// path forms — so look-alike hosts, other schemes, playlists, channels and anything else are refused.

/** A YouTube video id (stored as `items.video.youtube_id`). */
export const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** Latest start second accepted (24 h — 04 §6). */
export const YOUTUBE_START_MAX = 86_400;

/** A pasted link longer than this is refused before parsing (real share links are well under 200 characters). */
const LINK_MAX_LENGTH = 2048;

/** Hosts accepted exactly as written (the URL parser lowercases them). */
const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const SHORT_HOST = 'youtu.be';
const NOCOOKIE_HOST = 'www.youtube-nocookie.com';

/** `/shorts/<id>`, `/live/<id>`, `/embed/<id>` on the watch hosts (an optional trailing slash). */
const PATH_FORMS = /^\/(shorts|live|embed)\/([^/]+)\/?$/;
/** "90", "90s", "1h2m3s", "2m", "1h" — the forms YouTube puts into `t=`. */
const DURATION = /^(?:(\d{1,5})h)?(?:(\d{1,5})m)?(?:(\d{1,6})s?)?$/;

export type YouTubeLinkError =
  /** Not a URL at all, or too long. */
  | 'not_a_link'
  /** A URL, but not `https:` (or with a user name / password / port). */
  | 'not_https'
  /** Not one of the YouTube hosts — including look-alikes. */
  | 'not_youtube'
  /** A YouTube page that is not one video (a channel, a playlist without `v`, the home page …). */
  | 'not_a_video'
  /** `t` / `start` is not a time between 0 and 24 h. */
  | 'bad_start';

export type YouTubeLink = { readonly id: string; readonly startS?: number } | { readonly error: YouTubeLinkError };

/**
 * Parses an admin's pasted YouTube link (04 §6).
 *
 * @param input - what was pasted; surrounding white space is ignored.
 * @returns `{id, startS?}` — the video id (always matching {@link YOUTUBE_ID_PATTERN}) and the start second
 *   (1..{@link YOUTUBE_START_MAX}; omitted for 0 or none) — or `{error}`. Never throws.
 */
export function parseYouTubeLink(input: string): YouTubeLink {
  const text = input.trim();
  if (text.length === 0 || text.length > LINK_MAX_LENGTH) return { error: 'not_a_link' };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { error: 'not_a_link' };
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
    return { error: 'not_https' };
  }
  const id = videoIdOf(url);
  if (id === 'not_youtube' || id === 'not_a_video') return { error: id };
  const start = startOf(url.searchParams);
  if (start === null) return { error: 'bad_start' };
  return start === 0 ? { id } : { id, startS: start };
}

/** The id from one of the accepted host + path forms. */
function videoIdOf(url: URL): string {
  const host = url.hostname;
  let candidate: string | undefined;
  if (host === SHORT_HOST) {
    candidate = /^\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  } else if (host === NOCOOKIE_HOST) {
    const match = PATH_FORMS.exec(url.pathname);
    candidate = match?.[1] === 'embed' ? match[2] : undefined;
  } else if (WATCH_HOSTS.has(host)) {
    if (url.pathname === '/watch' || url.pathname === '/watch/') {
      const values = url.searchParams.getAll('v');
      candidate = values.length === 1 ? values[0] : undefined;
    } else {
      candidate = PATH_FORMS.exec(url.pathname)?.[2];
    }
  } else {
    return 'not_youtube';
  }
  return candidate !== undefined && YOUTUBE_ID_PATTERN.test(candidate) ? candidate : 'not_a_video';
}

/** Seconds from `t` (or `start`): 0 when absent; `null` when present but not a time within 24 h. */
function startOf(params: URLSearchParams): number | null {
  const raw = params.get('t') ?? params.get('start');
  if (raw === null || raw === '') return 0;
  const match = DURATION.exec(raw);
  if (!match) return null;
  const [, h = '0', m = '0', s = '0'] = match;
  const seconds = Number(h) * 3600 + Number(m) * 60 + Number(s);
  return seconds <= YOUTUBE_START_MAX ? seconds : null;
}

/**
 * The privacy-friendly embed the player inserts after the viewer taps Play (DECISIONS #39, 04 §7 `frame-src`).
 *
 * @param id - a video id matching {@link YOUTUBE_ID_PATTERN}.
 * @param startS - optional start second, 1..{@link YOUTUBE_START_MAX}.
 * @returns `https://www.youtube-nocookie.com/embed/<id>?autoplay=1&rel=0&playsinline=1[&start=n]`.
 * @throws RangeError for an id or start second that {@link parseYouTubeLink} would never produce.
 */
export function youTubeEmbedUrl(id: string, startS?: number): string {
  if (!YOUTUBE_ID_PATTERN.test(id)) throw new RangeError('youTubeEmbedUrl(): not a YouTube video id');
  if (startS !== undefined && (!Number.isSafeInteger(startS) || startS < 1 || startS > YOUTUBE_START_MAX)) {
    throw new RangeError('youTubeEmbedUrl(): start must be a whole second within 24 h');
  }
  const start = startS === undefined ? '' : `&start=${String(startS)}`;
  return `https://${NOCOOKIE_HOST}/embed/${id}?autoplay=1&rel=0&playsinline=1${start}`;
}
