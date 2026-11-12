// PHASE_06 T6.1 — the YouTube lookup adapter contract (04 §6 outbound rules): fixed hosts, URL built from the id, no
// redirects, 5 s timeout, size limits; 4xx → "cannot play" (null), network / 5xx / odd answers → VideoLookupFailed.
// The same contract runs against the mock and, with YOUTUBE_LIVE=1, against the real endpoints.
import { describe, expect, it } from 'vitest';

import {
  cleanVideoTitle,
  MOCK_FAILING_ID,
  MOCK_UNAVAILABLE_IDS,
  mockVideoLookup,
  VIDEO_TITLE_MAX,
  VideoLookupFailed,
  youTubeLookup,
} from '../src/video/youtube.ts';

const ID = 'AbC_123-xYz';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/** A fake `fetch` answering oEmbed and the thumbnail from the given responses, recording every call. */
function fakeFetch(oembed: () => Response, thumbnail: () => Response = () => jpeg(JPEG)) {
  const calls: Call[] = [];
  const fetch = (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(url.startsWith('https://www.youtube.com/oembed?') ? oembed() : thumbnail());
  };
  return { calls, fetch };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const jpeg = (bytes: Buffer, type = 'image/jpeg') =>
  new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': type } });

describe('youTubeLookup (fake fetch)', () => {
  it('asks only the two fixed hosts, with URLs built from the id, never following a redirect', async () => {
    const { calls, fetch } = fakeFetch(() => json({ title: 'Test bayan title', author_name: 'Test channel' }));
    expect(await youTubeLookup({ fetch }).lookup(ID)).toEqual({ title: 'Test bayan title', thumbnail: JPEG });
    expect(calls.map((call) => call.url)).toEqual([
      'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DAbC_123-xYz',
      'https://i.ytimg.com/vi/AbC_123-xYz/hqdefault.jpg',
    ]);
    for (const call of calls) {
      expect(call.init.redirect).toBe('error');
      expect(call.init.signal).toBeInstanceOf(AbortSignal);
      expect(call.init.method).toBe('GET');
    }
  });

  it.each([400, 401, 403, 404])('oEmbed %i → null (cannot play in the app); no thumbnail request', async (status) => {
    const { calls, fetch } = fakeFetch(() => new Response('Not Found', { status }));
    expect(await youTubeLookup({ fetch }).lookup(ID)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('no thumbnail (404) → the title alone', async () => {
    const { fetch } = fakeFetch(
      () => json({ title: 'T' }),
      () => new Response(null, { status: 404 }),
    );
    expect(await youTubeLookup({ fetch }).lookup(ID)).toEqual({ title: 'T', thumbnail: null });
  });

  it.each<[string, () => Response, (() => Response) | undefined]>([
    ['oEmbed 500', () => new Response('', { status: 500 }), undefined],
    ['oEmbed 302 surfaced as a status', () => new Response('', { status: 302 }), undefined],
    ['oEmbed not JSON', () => new Response('<html>', { status: 200 }), undefined],
    ['oEmbed JSON null', () => json(null), undefined],
    ['oEmbed without a title', () => json({ author_name: 'x' }), undefined],
    ['oEmbed title not text', () => json({ title: 5 }), undefined],
    [
      'oEmbed too large (declared)',
      () => new Response('{}', { status: 200, headers: { 'content-length': String(65 * 1024) } }),
      undefined,
    ],
    ['oEmbed too large (arrived)', () => json({ title: 'x'.repeat(70 * 1024) }), undefined],
    ['thumbnail 503', () => json({ title: 'T' }), () => new Response('', { status: 503 })],
    ['thumbnail not a JPEG', () => json({ title: 'T' }), () => jpeg(JPEG, 'text/html')],
    ['thumbnail without a type', () => json({ title: 'T' }), () => new Response(new Uint8Array(JPEG), { status: 200 })],
    ['thumbnail too large', () => json({ title: 'T' }), () => jpeg(Buffer.alloc(600 * 1024, 1))],
  ])('%s → VideoLookupFailed', async (_name, oembed, thumbnail) => {
    const { fetch } = fakeFetch(oembed, thumbnail);
    await expect(youTubeLookup({ fetch }).lookup(ID)).rejects.toBeInstanceOf(VideoLookupFailed);
  });

  it('network errors and timeouts → VideoLookupFailed', async () => {
    const fetch = () => Promise.reject(new TypeError('fetch failed'));
    await expect(youTubeLookup({ fetch }).lookup(ID)).rejects.toBeInstanceOf(VideoLookupFailed);
  });

  it('refuses an id the parser would never produce — no request is made', async () => {
    const { calls, fetch } = fakeFetch(() => json({ title: 'T' }));
    await expect(youTubeLookup({ fetch }).lookup('../../evil')).rejects.toBeInstanceOf(RangeError);
    expect(calls).toHaveLength(0);
  });
});

describe('cleanVideoTitle', () => {
  it('drops control and bidi characters, collapses white space, cuts to the limit by characters', () => {
    expect(cleanVideoTitle('  Test‮bayan\n\tpart\u00001  ')).toBe('Test bayan part 1');
    expect(Array.from(cleanVideoTitle('ب'.repeat(300)))).toHaveLength(VIDEO_TITLE_MAX);
  });
});

describe('mockVideoLookup — the same contract without a network', () => {
  const mock = mockVideoLookup(JPEG);
  it('playable ids get a test title and the given thumbnail', async () => {
    expect(await mock.lookup(ID)).toEqual({ title: `Test bayan ${ID}`, thumbnail: JPEG });
    expect(await mockVideoLookup(null).lookup(ID)).toEqual({ title: `Test bayan ${ID}`, thumbnail: null });
  });
  it.each(MOCK_UNAVAILABLE_IDS)('%s → null', async (id) => {
    expect(await mock.lookup(id)).toBeNull();
  });
  it('the failing id throws VideoLookupFailed; a malformed id a RangeError', async () => {
    await expect(mock.lookup(MOCK_FAILING_ID)).rejects.toBeInstanceOf(VideoLookupFailed);
    await expect(mock.lookup('nope')).rejects.toBeInstanceOf(RangeError);
  });
});

// Opt-in (YOUTUBE_LIVE=1): the real endpoints still behave as recorded in DECISIONS (a long-public non-religious test
// video and an id that does not exist).
describe.runIf(process.env['YOUTUBE_LIVE'] === '1')('youTubeLookup (live YouTube)', () => {
  it('a public video → title + JPEG thumbnail; an unknown id → null', async () => {
    const live = youTubeLookup();
    const found = await live.lookup('jNQXAC9IVRw');
    expect(found?.title.length).toBeGreaterThan(0);
    expect(found?.thumbnail?.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(await live.lookup('AAAAAAAAAAA')).toBeNull();
  });
});
