// PHASE_06 T6.2 (API) — bayans over HTTP as api-admin's own database user, with the mock YouTube adapter and the local
// file store: a valid link publishes (201; the push is audience-filtered); an invalid link → 422 INVALID_VIDEO_LINK; a
// private / deleted / embedding-off video (mock ids) → 422 VIDEO_UNAVAILABLE; YouTube unreachable → 503; the pasted URL
// is never in the stored document; another masjid → 404 without asking YouTube; 30 lookups per hour per masjid; list;
// edit within 24 h with If-Match. Fake titles and made-up ids only.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { processUserHandle } from '@mc/db/testing';
import { adminVideoListSchema, itemPublishedSchema, videoPreviewSchema } from '@mc/shared/contracts';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { memoryRateLimiter } from '../src/http/rate-limit.ts';
import { processRetention } from '../src/jobs/retention/run.ts';
import { createLogger } from '../src/logger.ts';
import type { CdnPurger } from '../src/media/cdn-purge.ts';
import { fileMediaStore, type MediaStore } from '../src/media/store.ts';
import { MOCK_FAILING_ID, MOCK_UNAVAILABLE_IDS, mockVideoLookup, type VideoLookup } from '../src/video/youtube.ts';
import { captureLogger } from './helpers.ts';
import { CSRF, superHarness } from './super-harness.ts';

const ID = 'AbC_123-xYz';
const asked: string[] = [];
let mediaDir = '';
let lookup: VideoLookup | undefined;
const recording: VideoLookup = {
  lookup: (id) => {
    asked.push(id);
    if (!lookup) throw new Error('no lookup');
    return lookup.lookup(id);
  },
};
const extra = {
  video: recording,
  media: {
    get store() {
      return fileMediaStore(mediaDir);
    },
    origin: 'https://media.test',
  },
};
// Every line the app and the routes log, at debug level and without redaction (PHASE_06 T6.2: the link never in logs).
const logs = captureLogger();
const harness = superHarness('video_routes', new Date('2026-11-13T06:30:00Z'), extra, {
  rateLimiter: memoryRateLimiter({ adminUploads: { points: 30, durationSec: 3600 } }),
  logger: logs.logger,
});
const { app, asSuper, register, testDatabase, clock } = harness;

let masjidId = '';
let otherMasjidId = '';
let cookie = '';
const call = (method: 'get' | 'post' | 'patch', path: string, masjid = masjidId) => {
  const built = request(app())[method](`/api/admin/masjids/${masjid}/videos${path}`).set('Cookie', cookie);
  return method === 'get' ? built : built.set(CSRF);
};
const codeOf = (response: request.Response) => (response.body as { code?: string }).code;
const valid = {
  url: `https://youtu.be/${ID}?t=90&si=Shar3Token`,
  title: 'Test bayan title',
  speaker: 'Test Speaker',
  audience: 'sisters',
  locale: 'en',
  rightsConfirmed: true,
  notify: false,
} as const;

async function masjid(name: string) {
  const created = await asSuper('post', '/masjids').send({
    name,
    area: 'Test Area',
    city: 'Hyderabad',
    state: 'Telangana',
    address: 'Test address',
    lat: 17.385,
    lng: 78.4867,
  });
  return (created.body as { id: string }).id;
}

beforeAll(async () => {
  mediaDir = await mkdtemp(join(tmpdir(), 'mc-video-'));
  const jpeg = await sharp({ create: { width: 480, height: 360, channels: 3, background: '#607870' } })
    .jpeg()
    .toBuffer();
  lookup = mockVideoLookup(jpeg);
  masjidId = await masjid('Test Masjid Bayan');
  otherMasjidId = await masjid('Test Masjid Other');
  const admin = await asSuper('post', '/admins').send({
    displayName: 'Test Imam',
    uiLocale: 'en',
    masjidId,
    role: 'editor',
  });
  cookie = await register((admin.body as { inviteUrl: string }).inviteUrl);
  const settings = await asSuper('get', '/settings');
  const version = (settings.body as { undertakingVersion: string }).undertakingVersion;
  await request(app()).post('/api/admin/auth/undertaking').set(CSRF).set('Cookie', cookie).send({ version });
});

afterAll(async () => {
  await rm(mediaDir, { recursive: true, force: true });
});

describe('B10 bayans', () => {
  let itemId = '';

  it('preview: title and our own thumbnail as a data URL (no YouTube URL reaches the phone)', async () => {
    const preview = await call('post', '/preview').send({ url: valid.url });
    expect(preview.status).toBe(200);
    const body = videoPreviewSchema.parse(preview.body);
    expect(body).toMatchObject({ youtubeId: ID, startS: 90, title: `Test bayan ${ID}` });
    expect(body.thumbnail).toMatch(/^data:image\/jpeg;base64,\/9j\//);
  });

  it.each([
    ['https://youtube.com.evil.example/watch?v=AbC_123-xYz'],
    ['http://www.youtube.com/watch?v=AbC_123-xYz'],
    ['https://www.youtube.com/playlist?list=PLabc'],
    ['not a link'],
  ])('%s → 422 INVALID_VIDEO_LINK, YouTube never asked', async (url) => {
    const before = asked.length;
    const response = await call('post', '/preview').send({ url });
    expect([response.status, codeOf(response)]).toEqual([422, 'INVALID_VIDEO_LINK']);
    expect(asked).toHaveLength(before);
  });

  it.each(MOCK_UNAVAILABLE_IDS)('%s (private / deleted / embedding off) → 422 VIDEO_UNAVAILABLE', async (id) => {
    const preview = await call('post', '/preview').send({ url: `https://www.youtube.com/watch?v=${id}` });
    expect([preview.status, codeOf(preview)]).toEqual([422, 'VIDEO_UNAVAILABLE']);
    const publish = await call('post', '').send({ ...valid, url: `https://youtu.be/${id}` });
    expect([publish.status, codeOf(publish)]).toEqual([422, 'VIDEO_UNAVAILABLE']);
  });

  it('YouTube unreachable → 503 VIDEO_LOOKUP_FAILED; another masjid → 404 without asking YouTube', async () => {
    const failing = await call('post', '/preview').send({ url: `https://youtu.be/${MOCK_FAILING_ID}` });
    expect([failing.status, codeOf(failing)]).toEqual([503, 'VIDEO_LOOKUP_FAILED']);
    const before = asked.length;
    const other = await call('post', '/preview', otherMasjidId).send({ url: valid.url });
    expect([other.status, codeOf(other)]).toEqual([404, 'MASJID_NOT_FOUND']);
    expect(asked).toHaveLength(before);
  });

  it('strict body: the audience is required, the ownership tick must be true', async () => {
    const { audience: _audience, ...noAudience } = valid;
    expect((await call('post', '').send(noAudience)).status).toBe(400);
    expect((await call('post', '').send({ ...valid, rightsConfirmed: false })).status).toBe(400);
    expect((await call('post', '').send({ ...valid, youtubeId: ID })).status).toBe(400);
  });

  it('publish 201: only the id, start and our thumbnail are stored — never the pasted link', async () => {
    const created = await call('post', '').send(valid);
    expect(created.status).toBe(201);
    const published = itemPublishedSchema.parse(created.body);
    itemId = published.item.id;
    const doc = await testDatabase().db.collection('items').findOne({ public_id: published.item.publicId });
    expect(doc).toMatchObject({
      type: 'video',
      audience: 'sisters',
      title: 'Test bayan title',
      video: { youtube_id: ID, start_s: 90, speaker: 'Test Speaker' },
    });
    expect(JSON.stringify(doc)).not.toMatch(/youtu\.be|youtube\.com|Shar3Token|https?:/);
    const thumb = (doc?.['video'] as { thumb_key: string }).thumb_key;
    expect(thumb.startsWith(`m/${masjidId}/`)).toBe(true);
  });

  it('list shows it; edit within 24 h needs If-Match and changes only the texts', async () => {
    const list = adminVideoListSchema.parse((await call('get', '')).body);
    const row = list.videos.find((entry) => entry.id === itemId);
    expect(row).toMatchObject({ status: 'published', audience: 'sisters', youtubeId: ID, startS: 90 });
    const noMatch = await call('patch', `/${itemId}`).send({ title: 'Test edited' });
    expect(noMatch.status).toBe(400);
    const edited = await call('patch', `/${itemId}`)
      .set('If-Match', `"${row?.updatedAt ?? ''}"`)
      .send({ title: 'Test edited', speaker: 'Test Speaker 2' });
    expect(edited.status).toBe(200);
    const after = adminVideoListSchema.parse((await call('get', '')).body).videos.find((entry) => entry.id === itemId);
    expect(after).toMatchObject({ title: 'Test edited', speaker: 'Test Speaker 2', youtubeId: ID });
    clock.set(new Date(clock.now().getTime() + 25 * 3_600_000));
    const late = await call('patch', `/${itemId}`)
      .set('If-Match', `"${after?.updatedAt ?? ''}"`)
      .send({ title: 'Too late' });
    expect([late.status, codeOf(late)]).toEqual([409, 'EDIT_WINDOW_CLOSED']);
    clock.set(new Date(clock.now().getTime() - 25 * 3_600_000)); // back: the sessions stay valid
  });

  it('T6.4: deleted → kept 180 days → the post, our thumbnail copy and its 6 CDN URLs are purged', async () => {
    const doc = await testDatabase().db.collection('items').findOne({ type: 'video', title: 'Test edited' });
    const thumb = (doc?.['video'] as { thumb_key: string }).thumb_key;
    const deleted = await request(app())
      .delete(`/api/admin/masjids/${masjidId}/items/${itemId}`)
      .set('Cookie', cookie)
      .set(CSRF);
    expect(deleted.status).toBe(204);
    const removedKeys: string[] = [];
    const purged: string[][] = [];
    const files = fileMediaStore(mediaDir);
    let failNext = false;
    const media: MediaStore = {
      ...files,
      deleteImage: async (key) => {
        if (failNext) {
          failNext = false;
          throw new Error('storage down');
        }
        removedKeys.push(key);
        await files.deleteImage(key);
      },
    };
    const purger: CdnPurger = {
      purge: (urls) => {
        purged.push([...urls]);
        return Promise.resolve();
      },
      purgeTags: () => Promise.resolve(),
    };
    const logger = createLogger({ level: 'silent', process: 'worker', release: 't' });
    const run = async (days: number) => {
      const back = clock.now();
      clock.set(new Date(back.getTime() + days * 24 * 3_600_000));
      const system = await processUserHandle(testDatabase(), 'mc_system');
      try {
        return await processRetention({
          db: system.handle,
          clock,
          logger,
          media,
          purger,
          mediaOrigin: 'https://media.test/',
        });
      } finally {
        await system.dispose();
        clock.set(back);
      }
    };
    expect(await run(179)).toMatchObject({ items: 0, mediaFiles: 0 });
    expect(removedKeys).toEqual([]);
    // Storage fails once: the post is kept (nothing stranded) and the run fails so the job retries (#165 M1).
    failNext = true;
    await expect(run(181)).rejects.toThrow(/could not be deleted/);
    expect(await testDatabase().db.collection('items').countDocuments({ public_id: doc?.['public_id'] })).toBe(1);
    expect(purged).toEqual([]);
    expect(await run(181)).toMatchObject({ items: 1, mediaFiles: 1 });
    expect(removedKeys).toEqual([thumb]);
    expect(purged).toEqual([
      [480, 960, 1440].flatMap((width) =>
        ['avif', 'webp'].map((format) => `https://media.test/i/${String(width)}/${format}/${thumb}`),
      ),
    ]);
    expect(await testDatabase().db.collection('items').countDocuments({ public_id: doc?.['public_id'] })).toBe(0);
    expect(await run(182)).toMatchObject({ items: 0 }); // idempotent
  });

  it("another masjid's admin cannot spend this masjid's lookup budget (#165 M2)", async () => {
    const other = await asSuper('post', '/admins').send({
      displayName: 'Test Other Imam',
      uiLocale: 'en',
      masjidId: otherMasjidId,
      role: 'owner',
    });
    const otherCookie = await register((other.body as { inviteUrl: string }).inviteUrl);
    const settings = await asSuper('get', '/settings');
    const version = (settings.body as { undertakingVersion: string }).undertakingVersion;
    await request(app()).post('/api/admin/auth/undertaking').set(CSRF).set('Cookie', otherCookie).send({ version });
    for (let n = 0; n < 31; n += 1) {
      const attack = await request(app())
        .post(`/api/admin/masjids/${masjidId}/videos/preview`)
        .set('Cookie', otherCookie)
        .set(CSRF)
        .send({ url: valid.url });
      expect(attack.status).toBe(404);
    }
    expect((await call('post', '/preview').send({ url: valid.url })).status).toBe(200);
  });

  it('30 lookups per hour per masjid: the next one is 429', async () => {
    let status = 0;
    for (let n = 0; n < 40 && status !== 429; n += 1) {
      status = (await call('post', '/preview').send({ url: valid.url })).status;
    }
    expect(status).toBe(429);
  });

  it('the pasted link, its id and its share token never reach a log line (PHASE_06 T6.2)', () => {
    const lines = logs.lines().map((line) => JSON.stringify(line));
    expect(lines.length).toBeGreaterThan(20); // every request above was logged
    for (const line of lines) {
      expect(line).not.toContain(ID);
      expect(line).not.toContain('Shar3Token');
      expect(line).not.toMatch(/youtu\.?be/u);
    }
  });
});
