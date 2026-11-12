import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseYouTubeLink, YOUTUBE_ID_PATTERN, YOUTUBE_START_MAX, youTubeEmbedUrl } from '../src/youtube.ts';

// PHASE_06 T6.1 · 04 §6 · DECISIONS #39: an admin's pasted YouTube link → the 11-character id (+ start second);
// `https:` only, exact host allow-list (look-alikes fail), fixed path forms; the embed URL is built by us on
// youtube-nocookie.com. Ids below are made up (any 11 characters of the id alphabet).

const ID = 'AbC_123-xYz';
const idChars = fc.constantFrom(...Array.from('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'));
const anyId = fc.string({ unit: idChars, minLength: 11, maxLength: 11 });
const forms = [
  (id: string) => `https://www.youtube.com/watch?v=${id}`,
  (id: string) => `https://youtube.com/watch?v=${id}&feature=share`,
  (id: string) => `https://m.youtube.com/watch?app=desktop&v=${id}`,
  (id: string) => `https://youtu.be/${id}?si=Shar3Token`,
  (id: string) => `https://www.youtube.com/shorts/${id}`,
  (id: string) => `https://www.youtube.com/live/${id}?feature=shared`,
  (id: string) => `https://www.youtube.com/embed/${id}`,
  (id: string) => `https://www.youtube-nocookie.com/embed/${id}`,
];

describe('parseYouTubeLink — accepted forms', () => {
  it.each([
    ['https://www.youtube.com/watch?v=AbC_123-xYz', { id: ID }],
    ['  https://youtu.be/AbC_123-xYz  ', { id: ID }],
    ['https://youtu.be/AbC_123-xYz/', { id: ID }],
    ['https://WWW.YouTube.com/watch/?v=AbC_123-xYz', { id: ID }],
    ['https://www.youtube.com:443/watch?v=AbC_123-xYz', { id: ID }],
    ['https://www.youtube.com/shorts/AbC_123-xYz/', { id: ID }],
    ['https://www.youtube.com/live/AbC_123-xYz', { id: ID }],
    ['https://youtube.com/embed/AbC_123-xYz', { id: ID }],
    ['https://www.youtube-nocookie.com/embed/AbC_123-xYz?start=30', { id: ID, startS: 30 }],
    ['https://youtu.be/AbC_123-xYz?t=90', { id: ID, startS: 90 }],
    ['https://youtu.be/AbC_123-xYz?t=90s', { id: ID, startS: 90 }],
    ['https://www.youtube.com/watch?v=AbC_123-xYz&t=1h2m3s', { id: ID, startS: 3723 }],
    ['https://www.youtube.com/watch?v=AbC_123-xYz&t=2m', { id: ID, startS: 120 }],
    ['https://www.youtube.com/watch?v=AbC_123-xYz&t=1h', { id: ID, startS: 3600 }],
    ['https://www.youtube.com/watch?v=AbC_123-xYz&t=0', { id: ID }], // 0 = from the start
    ['https://www.youtube.com/watch?v=AbC_123-xYz&t=', { id: ID }],
    ['https://www.youtube.com/watch?v=AbC_123-xYz&t=24h', { id: ID, startS: YOUTUBE_START_MAX }],
  ])('%s', (input, expected) => {
    expect(parseYouTubeLink(input)).toEqual(expected);
  });

  it('every accepted form of any id yields that id', () => {
    fc.assert(
      fc.property(anyId, fc.integer({ min: 0, max: forms.length - 1 }), (id, form) => {
        const build = forms[form];
        if (!build) throw new Error('form');
        expect(parseYouTubeLink(build(id))).toEqual({ id });
      }),
    );
  });

  it('whatever is pasted, an accepted result is a valid id and an in-range start', () => {
    const noisy = fc.oneof(
      fc.string({ maxLength: 120 }),
      fc.webUrl({ withQueryParameters: true, withFragments: true }),
      fc
        .tuple(fc.constantFrom(...forms), anyId, fc.string({ maxLength: 20 }))
        .map(([build, id, tail]) => build(id) + tail),
    );
    fc.assert(
      fc.property(noisy, (input) => {
        const result = parseYouTubeLink(input);
        if ('id' in result) {
          expect(result.id).toMatch(YOUTUBE_ID_PATTERN);
          if (result.startS !== undefined) {
            expect(Number.isSafeInteger(result.startS)).toBe(true);
            expect(result.startS).toBeGreaterThanOrEqual(1);
            expect(result.startS).toBeLessThanOrEqual(YOUTUBE_START_MAX);
          }
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('parseYouTubeLink — refused', () => {
  it.each([
    ['', 'not_a_link'],
    ['   ', 'not_a_link'],
    ['youtube.com/watch?v=AbC_123-xYz', 'not_a_link'], // no scheme
    ['not a link', 'not_a_link'],
    [`https://youtu.be/${'a'.repeat(2100)}`, 'not_a_link'],
    ['http://www.youtube.com/watch?v=AbC_123-xYz', 'not_https'],
    ['javascript:alert(1)//youtube.com/watch?v=AbC_123-xYz', 'not_https'],
    ['https://user:pw@www.youtube.com/watch?v=AbC_123-xYz', 'not_https'],
    ['https://www.youtube.com:8443/watch?v=AbC_123-xYz', 'not_https'],
    ['https://youtube.com.evil.example/watch?v=AbC_123-xYz', 'not_youtube'],
    ['https://evil.example/youtube.com/watch?v=AbC_123-xYz', 'not_youtube'],
    ['https://notyoutube.com/watch?v=AbC_123-xYz', 'not_youtube'],
    ['https://youtube.com./watch?v=AbC_123-xYz', 'not_youtube'],
    ['https://music.youtube.com/watch?v=AbC_123-xYz', 'not_youtube'],
    ['https://youtube-nocookie.com/embed/AbC_123-xYz', 'not_youtube'],
    ['https://www.youtube.com/', 'not_a_video'],
    ['https://www.youtube.com/playlist?list=PLabc', 'not_a_video'],
    ['https://www.youtube.com/watch?list=PLabc', 'not_a_video'], // a playlist without v
    ['https://www.youtube.com/@TestMasjidChannel', 'not_a_video'],
    ['https://www.youtube.com/channel/UCabcdefghijk', 'not_a_video'],
    ['https://www.youtube.com/watch?v=AbC_123-xY', 'not_a_video'], // 10 characters
    ['https://www.youtube.com/watch?v=AbC_123-xYz1', 'not_a_video'], // 12 characters
    ['https://www.youtube.com/watch?v=AbC_123%2BxYz', 'not_a_video'],
    ['https://www.youtube.com/watch?v=AbC_123-xYz&v=Other_id-12', 'not_a_video'], // two ids
    ['https://www.youtube.com/shorts/AbC_123-xYz/extra', 'not_a_video'],
    ['https://www.youtube-nocookie.com/watch?v=AbC_123-xYz', 'not_a_video'],
    ['https://www.youtube-nocookie.com/shorts/AbC_123-xYz', 'not_a_video'],
    ['https://youtu.be/', 'not_a_video'],
    ['https://youtu.be/watch/AbC_123-xYz', 'not_a_video'],
    ['https://youtu.be/AbC_123-xYz?t=abc', 'bad_start'],
    ['https://youtu.be/AbC_123-xYz?t=-5', 'bad_start'],
    ['https://youtu.be/AbC_123-xYz?t=1.5', 'bad_start'],
    ['https://youtu.be/AbC_123-xYz?t=86401', 'bad_start'],
    ['https://youtu.be/AbC_123-xYz?start=25h', 'bad_start'],
  ])('%s → %s', (input, error) => {
    expect(parseYouTubeLink(input)).toEqual({ error });
  });

  it('look-alike hosts around a real link are never accepted', () => {
    const evil = fc.constantFrom(
      'evil.example',
      'youtube.com.evil.example',
      'youtu.be.evil.example',
      'xn--ytube-6ya.com',
    );
    fc.assert(
      fc.property(anyId, evil, (id, host) => {
        expect(parseYouTubeLink(`https://${host}/watch?v=${id}`)).toEqual({ error: 'not_youtube' });
        expect(parseYouTubeLink(`https://${host}/${id}`)).toEqual({ error: 'not_youtube' });
      }),
    );
  });
});

describe('youTubeEmbedUrl', () => {
  it('builds the nocookie embed with autoplay, no related videos from other channels, inline on iPhone', () => {
    expect(youTubeEmbedUrl(ID)).toBe(
      'https://www.youtube-nocookie.com/embed/AbC_123-xYz?autoplay=1&rel=0&playsinline=1',
    );
    expect(youTubeEmbedUrl(ID, 90)).toBe(
      'https://www.youtube-nocookie.com/embed/AbC_123-xYz?autoplay=1&rel=0&playsinline=1&start=90',
    );
  });

  it('round-trips with the parser', () => {
    fc.assert(
      fc.property(anyId, fc.integer({ min: 1, max: YOUTUBE_START_MAX }), (id, start) => {
        expect(parseYouTubeLink(youTubeEmbedUrl(id, start))).toEqual({ id, startS: start });
      }),
    );
  });

  it.each([
    ['bad id', 'AbC', undefined],
    ['injection in the id', 'AbC_123-x"/', undefined],
    ['start 0', ID, 0],
    ['start too late', ID, YOUTUBE_START_MAX + 1],
    ['fractional start', ID, 1.5],
  ])('refuses %s', (_name, id, start) => {
    expect(() => youTubeEmbedUrl(id, start)).toThrow(RangeError);
  });
});
