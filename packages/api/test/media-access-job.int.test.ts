// PHASE_08 T8.2 / F73 — the `media-access` job: a post's files follow its CURRENT status (security review M1): removed
// → restricted and purged from the CDN by URL; restored (published) → delivered again; files another published post
// still uses are left alone; a post without files, or a worker without a media store, changes nothing.
import { idText, newId } from '@mc/db';
import { runMigrations } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';
import { seedPublicId } from '@mc/db/seed';
import { createTestDatabase, processUserHandle, type TestDatabase } from '@mc/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { processMediaAccess } from '../src/jobs/cdn/media-access.ts';
import { runDevSeed } from '../src/jobs/seed.ts';
import type { CdnPurger } from '../src/media/cdn-purge.ts';
import type { MediaStore } from '../src/media/store.ts';
import { silentLogger } from './helpers.ts';

const NOW = new Date('2026-11-14T06:00:00Z');
const ORIGIN = 'https://media.example.test';

let test: TestDatabase | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const sys = () => {
  if (!asSystem) throw new Error('no mc_system handle');
  return asSystem.handle;
};

/** What the job asked the store and the CDN to do. */
const calls: string[] = [];
const purged: string[][] = [];
const record = (what: string) => (key: string) => {
  calls.push(`${what} ${key}`);
  return Promise.resolve();
};
const media = {
  restrictImage: record('restrictImage'),
  unrestrictImage: record('unrestrictImage'),
  restrictAudio: record('restrictAudio'),
  unrestrictAudio: record('unrestrictAudio'),
} as unknown as MediaStore; // only the four access methods are used by the job
const purger: CdnPurger = {
  purge: (urls) => {
    purged.push([...urls]);
    return Promise.resolve();
  },
  purgeTags: () => Promise.resolve(),
};
const deps = (overrides: Partial<Parameters<typeof processMediaAccess>[0]> = {}) => ({
  db: sys(),
  media,
  purger,
  mediaOrigin: ORIGIN,
  logger: silentLogger(),
  ...overrides,
});
type Id = ReturnType<typeof newId>;
const items = () => t().db.collection<{ _id: Id; public_id: string } & Record<string, unknown>>('items');
const idOf = async (publicId: string) => {
  const doc = await items().findOne({ public_id: publicId });
  if (!doc) throw new Error(`no ${publicId}`);
  return idText(doc._id);
};
const reset = () => {
  calls.length = 0;
  purged.length = 0;
};

beforeAll(async () => {
  test = await createTestDatabase('media-access-job');
  await runMigrations(t().db, MIGRATIONS);
  asSystem = await processUserHandle(t(), 'mc_system');
  await runDevSeed(sys(), 'local', NOW);
  // Two posts with their own image and recording; a third, published, shares the second post's image.
  await items().updateOne(
    { public_id: seedPublicId('alpha', 0) },
    { $set: { image_key: 'notices/test-own-a', status: 'removed' } },
  );
  await items().updateOne({ public_id: seedPublicId('alpha', 1) }, { $set: { image_key: 'notices/test-shared' } });
  await items().updateOne({ public_id: seedPublicId('alpha', 2) }, { $set: { image_key: 'notices/test-shared' } });
});

afterAll(async () => {
  await asSystem?.dispose();
  await test?.dispose();
});

describe('media-access job (F73, M1)', () => {
  it('removed: its own files are restricted and purged from the CDN by URL', async () => {
    reset();
    const itemId = await idOf(seedPublicId('alpha', 0));
    // `restrict: false` in the payload is ignored — the post's status decides (M1).
    expect(await processMediaAccess(deps(), { itemId, restrict: false })).toEqual({ files: 1 });
    expect(calls).toEqual(['restrictImage notices/test-own-a']);
    expect(purged).toHaveLength(1);
    expect(purged[0]?.every((url) => url.startsWith(`${ORIGIN}/i/`) && url.endsWith('/notices/test-own-a'))).toBe(true);
  });

  it('restored (published again): delivered again, nothing purged', async () => {
    reset();
    const itemId = await idOf(seedPublicId('alpha', 0));
    await items().updateOne({ public_id: seedPublicId('alpha', 0) }, { $set: { status: 'published' } });
    expect(await processMediaAccess(deps(), { itemId })).toEqual({ files: 1 });
    expect(calls).toEqual(['unrestrictImage notices/test-own-a']);
    expect(purged).toEqual([]);
  });

  it('a file another published post still uses is never restricted', async () => {
    reset();
    await items().updateOne({ public_id: seedPublicId('alpha', 1) }, { $set: { status: 'removed' } });
    expect(await processMediaAccess(deps(), { itemId: await idOf(seedPublicId('alpha', 1)) })).toEqual({ files: 0 });
    expect(calls).toEqual([]);
  });

  it('no files, no media store, no CDN: nothing changes and nothing throws', async () => {
    reset();
    expect(await processMediaAccess(deps(), { itemId: await idOf(seedPublicId('beta', 0)) })).toEqual({ files: 0 });
    const own = await idOf(seedPublicId('alpha', 0));
    await items().updateOne({ public_id: seedPublicId('alpha', 0) }, { $set: { status: 'removed' } });
    expect(await processMediaAccess(deps({ media: undefined }), { itemId: own })).toEqual({ files: 0 });
    expect(await processMediaAccess(deps({ purger: undefined }), { itemId: own })).toEqual({ files: 1 });
    expect(purged).toEqual([]);
    expect(calls).toEqual(['restrictImage notices/test-own-a']);
  });

  it('an unknown post is refused by the data layer; a malformed id never reaches it', async () => {
    await expect(processMediaAccess(deps(), { itemId: idText(newId()) })).rejects.toThrow();
    await expect(processMediaAccess(deps(), { itemId: 'not-a-uuid' })).rejects.toThrow('malformed item id');
  });
});
