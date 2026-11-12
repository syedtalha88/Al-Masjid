// PHASE_06 T6.2 — bayan videos as the real `mc_admin` / `mc_public` users: publish stores only the YouTube id, the start
// second, the speaker and our thumbnail copy (never a link); the audience is filtered in the public query (sisters-only
// is invisible to brothers); a notifying publish writes an audience-filtered outbox job; every input rule; edits within
// 24 h (texts only, If-Match); the admin list shows published / deleted. Fake titles and made-up ids only.
import type { UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { listFeed, listVideosForAdmin } from '../src/repos/index.ts';
import { adminScope, systemScope } from '../src/scope.ts';
import { buildDevSeed, seedId, writeDevSeed } from '../src/seed/index.ts';
import { deleteItem, editVideo, publishVideo, type VideoInput } from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { idText, newId, parseId } from '../src/values.ts';

const NOW = new Date('2026-11-13T06:30:00Z');
const TODAY = '2026-11-13';
const ALPHA = seedId('masjid-alpha');
const BETA = seedId('masjid-beta');
const HOUR = 3_600_000;

let test: TestDatabase | undefined;
const handles: Partial<Record<'admin' | 'system' | 'public', Awaited<ReturnType<typeof processUserHandle>>>> = {};
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const as = (user: 'admin' | 'system' | 'public'): DbHandle => {
  const entry = handles[user];
  if (!entry) throw new Error(`no ${user} handle`);
  return entry.handle;
};
const raw = (name: string) => t().db.collection<{ _id: UUID } & Record<string, unknown>>(name);
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof StateError) return error.code;
    throw error;
  }
};
const alpha = adminScope({ adminId: newId(), masjids: [{ id: ALPHA, role: 'editor' }] }); // editors may publish
const idOf = (text: string) => {
  const id = parseId(text);
  if (!id) throw new Error(`not an id: ${text}`);
  return id;
};
const video = (overrides: Partial<VideoInput> = {}): VideoInput => ({
  youtubeId: 'AbC_123-xYz',
  title: 'Test bayan title',
  speaker: 'Test Speaker',
  description: 'Placeholder description',
  audience: 'everyone',
  locale: 'en',
  thumb: { key: `m/${idText(ALPHA)}/11111111-1111-4111-8111-111111111111`, thumbhash: 'AAAA' },
  rightsConfirmed: true,
  ...overrides,
});
const publish = (input = video(), notify = false, at = NOW) =>
  publishVideo(as('admin'), alpha, { masjidId: ALPHA, video: input, notify, now: at, requestId: 'req-video-1' });
const feed = (audiences: ('everyone' | 'brothers' | 'sisters')[]) =>
  listFeed(as('public'), ALPHA, { type: 'video', audiences });

beforeAll(async () => {
  test = await createTestDatabase('videos-state');
  await runMigrations(t().db, MIGRATIONS);
  handles.admin = await processUserHandle(t(), 'mc_admin');
  handles.system = await processUserHandle(t(), 'mc_system');
  handles.public = await processUserHandle(t(), 'mc_public');
  await writeDevSeed(as('system'), systemScope(), buildDevSeed({ now: NOW, today: TODAY }));
});

afterAll(async () => {
  for (const entry of Object.values(handles)) await entry.dispose();
  await test?.dispose();
});

describe('publishVideo', () => {
  it('stores only the id, start, speaker and our thumbnail — never a link; audited without the title', async () => {
    const { item } = await publish(video({ startS: 90 }));
    const doc = await raw('items').findOne({ _id: idOf(item.id) });
    expect(doc).toMatchObject({
      type: 'video',
      status: 'published',
      audience: 'everyone',
      title: 'Test bayan title',
      body: 'Placeholder description',
      content_locale: 'en',
      rights_confirmed: true,
      video: {
        youtube_id: 'AbC_123-xYz',
        start_s: 90,
        speaker: 'Test Speaker',
        thumb_key: `m/${idText(ALPHA)}/11111111-1111-4111-8111-111111111111`,
        thumb_thumbhash: 'AAAA',
      },
    });
    expect(JSON.stringify(doc)).not.toMatch(/youtube\.com|youtu\.be|https?:/);
    const audit = await raw('audit_log').findOne({ action: 'video.publish', target_id: item.id });
    expect(audit).toMatchObject({ masjid_id: ALPHA, meta: { audience: 'everyone', notify: false } });
    expect(JSON.stringify(audit)).not.toMatch(/Test bayan|AbC_123/);
  });

  it('audience is filtered in the public query: sisters-only never reaches a brothers device', async () => {
    const { item } = await publish(video({ title: 'Test sisters bayan', audience: 'sisters' }));
    const brothers = await feed(['everyone', 'brothers']);
    const sisters = await feed(['everyone', 'sisters']);
    expect(brothers.items.map((entry) => entry.publicId)).not.toContain(item.publicId);
    expect(sisters.items.map((entry) => entry.publicId)).toContain(item.publicId);
    expect(sisters.items.find((entry) => entry.publicId === item.publicId)).toMatchObject({
      type: 'video',
      video: { youtubeId: 'AbC_123-xYz', speaker: 'Test Speaker' },
    });
  });

  it('a notifying publish writes an outbox job for that audience only', async () => {
    const { notificationJobId, quotaLeft } = await publish(video({ audience: 'brothers' }), true);
    expect(quotaLeft).not.toBeNull();
    expect(await raw('notification_jobs').findOne({ _id: idOf(notificationJobId ?? '') })).toMatchObject({
      audience: 'brothers',
      audience_targets: ['brothers'],
      status: 'pending',
    });
  });

  it.each<[string, Partial<VideoInput>]>([
    ['empty title', { title: '  ' }],
    ['title too long', { title: 'x'.repeat(121) }],
    ['speaker too long', { speaker: 'x'.repeat(81) }],
    ['description too long', { description: 'x'.repeat(1501) }],
    ['malformed id', { youtubeId: 'not-an-id' }],
    ['start 0', { startS: 0 }],
    ['start beyond 24 h', { startS: 86_401 }],
    ['unknown audience', { audience: 'all' as VideoInput['audience'] }],
    ['another masjid’s thumbnail', { thumb: { key: `m/${idText(BETA)}/x`, thumbhash: 'AAAA' } }],
    ['no ownership tick', { rightsConfirmed: false as unknown as true }],
  ])('refuses %s (VIDEO_INVALID)', async (_name, overrides) => {
    expect(await code(publish(video(overrides)))).toBe('VIDEO_INVALID');
  });

  it('refuses another masjid and the system scope', async () => {
    const beta = adminScope({ adminId: newId(), masjids: [{ id: BETA, role: 'owner' }] });
    expect(
      await code(publishVideo(as('admin'), beta, { masjidId: ALPHA, video: video(), notify: false, now: NOW })),
    ).toBe('MASJID_NOT_FOUND');
    expect(
      await code(publishVideo(as('admin'), systemScope(), { masjidId: ALPHA, video: video(), notify: false })),
    ).toBe('MASJID_NOT_FOUND');
  });
});

describe('editVideo and the admin list', () => {
  it('edits texts within 24 h with If-Match; the video and audience stay; then the window closes', async () => {
    const { item } = await publish(video({ title: 'Test before edit', audience: 'sisters' }));
    const listed = (await listVideosForAdmin(as('admin'), alpha, ALPHA)).videos.find((row) => row.id === item.id);
    if (!listed) throw new Error('not listed');
    expect(listed).toMatchObject({ status: 'published', audience: 'sisters', youtubeId: 'AbC_123-xYz' });
    const later = new Date(NOW.getTime() + HOUR);
    const edit = (ifMatch: string, at = later, speaker?: string) =>
      editVideo(as('admin'), alpha, {
        masjidId: ALPHA,
        itemId: idOf(item.id),
        ifMatch,
        title: 'Test after edit',
        speaker,
        description: '',
        now: at,
      });
    expect(await code(edit('2000-01-01T00:00:00.000Z'))).toBe('PRECONDITION_FAILED');
    const { updatedAt } = await edit(listed.updatedAt);
    const doc = await raw('items').findOne({ _id: idOf(item.id) });
    expect(doc).toMatchObject({ title: 'Test after edit', audience: 'sisters', video: { youtube_id: 'AbC_123-xYz' } });
    expect(doc?.['body']).toBeUndefined();
    expect((doc?.['video'] as Record<string, unknown>)['speaker']).toBeUndefined();
    expect(await code(edit(updatedAt, new Date(NOW.getTime() + 25 * HOUR)))).toBe('EDIT_WINDOW_CLOSED');
  });

  it('deleted bayans stay in the admin list as deleted and leave the public feed', async () => {
    const { item } = await publish(video({ title: 'Test to delete' }));
    await deleteItem(as('admin'), alpha, { masjidId: ALPHA, itemId: idOf(item.id), now: NOW });
    const row = (await listVideosForAdmin(as('admin'), alpha, ALPHA)).videos.find((entry) => entry.id === item.id);
    expect(row?.status).toBe('deleted');
    const everyone = await feed(['everyone', 'brothers', 'sisters']);
    expect(everyone.items.map((entry) => entry.publicId)).not.toContain(item.publicId);
    expect(
      await code(
        editVideo(as('admin'), alpha, {
          masjidId: ALPHA,
          itemId: idOf(item.id),
          ifMatch: row?.updatedAt ?? '',
          title: 'x',
          now: NOW,
        }),
      ),
    ).toBe('ITEM_NOT_FOUND');
  });
});
