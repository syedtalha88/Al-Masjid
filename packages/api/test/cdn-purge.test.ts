// PHASE_06 T6.4 — the Cloudflare purge-by-URL client (verified against Cloudflare's docs, 13 Nov 2026): POST
// /zones/<zone>/purge_cache with {"files": [...]}, Bearer token, at most 100 URLs per request, no redirects; anything but
// HTTP 200 with `success: true` is a refusal (the job retries). And the delivery URLs a stored file has.
import { describe, expect, it } from 'vitest';

import { processCdnPurge } from '../src/jobs/cdn/purge.ts';
import { cloudflarePurger, mediaDeliveryUrls, noCdnPurger, PURGE_BATCH } from '../src/media/cdn-purge.ts';
import { silentLogger } from './helpers.ts';

const ZONE = '0123456789abcdef0123456789abcdef';

function fake(answer: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(answer());
  };
  return { calls, fetch };
}
const ok = () => Response.json({ errors: [], messages: [], result: { id: 'x' }, success: true });

describe('cloudflarePurger', () => {
  it('sends the URLs in batches of 100 to the zone, with the token as Bearer, never following redirects', async () => {
    const { calls, fetch } = fake(ok);
    const urls = Array.from({ length: 250 }, (_, n) => `https://media.test/i/480/webp/m/x/${String(n)}`);
    await cloudflarePurger({ token: 'test-token', zoneId: ZONE, fetch }).purge(urls);
    expect(calls).toHaveLength(3);
    expect(PURGE_BATCH).toBe(100);
    for (const call of calls) {
      expect(call.url).toBe(`https://api.cloudflare.com/client/v4/zones/${ZONE}/purge_cache`);
      expect(call.init.method).toBe('POST');
      expect(call.init.redirect).toBe('error');
      expect(call.init.headers).toMatchObject({ Authorization: 'Bearer test-token' });
    }
    // The client sends a JSON string body.
    const sizes = calls.map((call) => (JSON.parse(call.init.body as string) as { files: string[] }).files.length);
    expect(sizes).toEqual([100, 100, 50]);
  });

  it.each([
    ['HTTP 403', () => Response.json({ success: false }, { status: 403 })],
    ['success false', () => Response.json({ success: false, errors: [{ code: 1134 }] })],
    ['not JSON', () => new Response('<html>', { status: 200 })],
  ])('%s → throws (the job retries)', async (_name, answer) => {
    const { fetch } = fake(answer);
    await expect(cloudflarePurger({ token: 't', zoneId: ZONE, fetch }).purge(['https://media.test/a'])).rejects.toThrow(
      /cdn purge refused/,
    );
  });

  it('nothing to purge → no request; a malformed zone id is refused at start', async () => {
    const { calls, fetch } = fake(ok);
    await cloudflarePurger({ token: 't', zoneId: ZONE, fetch }).purge([]);
    expect(calls).toHaveLength(0);
    expect(() => cloudflarePurger({ token: 't', zoneId: 'zone/../x', fetch })).toThrow(/zone id/);
    await expect(noCdnPurger.purge(['https://media.test/a'])).resolves.toBeUndefined();
  });
});

describe('mediaDeliveryUrls', () => {
  it('an image: its six named transformations; a voice note: its m4a', () => {
    expect(mediaDeliveryUrls('https://media.test/', { images: ['m/a/b'], audio: ['m/a/a/c'] })).toEqual([
      'https://media.test/i/480/avif/m/a/b',
      'https://media.test/i/480/webp/m/a/b',
      'https://media.test/i/960/avif/m/a/b',
      'https://media.test/i/960/webp/m/a/b',
      'https://media.test/i/1440/avif/m/a/b',
      'https://media.test/i/1440/webp/m/a/b',
      'https://media.test/a/m4a/m/a/a/c',
    ]);
  });
});

// PHASE_08 T8.2 — purge by cache tag (verified 13 Nov 2026: every plan, `{"tags": [...]}`, ≤ 100 per request) and the
// `cdn-purge` job.
describe('purge by cache tag', () => {
  it('sends the tags to the same endpoint, in batches of 100', async () => {
    const { calls, fetch } = fake(ok);
    const tags = Array.from({ length: 101 }, (_, n) => `i-tag${String(n)}`);
    await cloudflarePurger({ token: 'test-token', zoneId: ZONE, fetch }).purgeTags(tags);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe(`https://api.cloudflare.com/client/v4/zones/${ZONE}/purge_cache`);
    const bodies = calls.map((call) => JSON.parse(call.init.body as string) as Record<string, string[]>);
    expect(Object.keys(bodies[0] ?? {})).toEqual(['tags']);
    expect(bodies.map((body) => body['tags']?.length)).toEqual([100, 1]);
  });

  it('a refusal or rate limit (1134) throws, so the job retries', async () => {
    const { fetch } = fake(() => Response.json({ success: false, errors: [{ code: 1134 }] }, { status: 429 }));
    await expect(cloudflarePurger({ token: 't', zoneId: ZONE, fetch }).purgeTags(['i-x'])).rejects.toThrow(
      /cdn purge refused: HTTP 429/,
    );
  });

  it('the job purges with the purger, and does nothing without one (local)', async () => {
    const asked: string[][] = [];
    const logger = silentLogger();
    const purger = {
      ...noCdnPurger,
      purgeTags: (tags: readonly string[]) => (asked.push([...tags]), Promise.resolve()),
    };
    expect(await processCdnPurge({ purger, logger }, { tags: ['i-abcdefghijkl', 'm-x'] })).toEqual({ purged: true });
    expect(asked).toEqual([['i-abcdefghijkl', 'm-x']]);
    expect(await processCdnPurge({ purger: undefined, logger }, { tags: ['i-a'] })).toEqual({ purged: false });
  });
});
