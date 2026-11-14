// PHASE_08 T8.2 / T8.7 without a job queue (local without Redis, or Redis down at boot): every moderation action still
// commits and says honestly that nothing was queued (`cdnPurgeQueued: false`, `queued: false`) — the Super Admin then
// uses "Clear the cache again". Also C2's repeat-violation count (05 §3): removals of the last 90 days.
import { idText, isId } from '@mc/db';
import { seedId, seedPublicId } from '@mc/db/seed';
import { processUserHandle } from '@mc/db/testing';
import { superMasjidDetailSchema } from '@mc/shared/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runDevSeed } from '../src/jobs/seed.ts';
import { superHarness } from './super-harness.ts';

const NOW = new Date('2026-11-14T06:30:00Z');
const ALPHA = idText(seedId('masjid-alpha'));
const DAY = 24 * 60 * 60 * 1000;
const harness = superHarness('moderation-no-queue', NOW);
const { asSuper, stepUp, clock } = harness;

let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const itemIdOf = async (publicId: string) => {
  const id: unknown = (await harness.db().collection('items').findOne({ public_id: publicId }))?.['_id'];
  if (!isId(id)) throw new Error(`no item ${publicId}`);
  return idText(id);
};
const removals = async () => {
  const response = await asSuper('get', `/masjids/${ALPHA}`);
  if (response.status !== 200)
    throw new Error(`GET masjid ${String(response.status)} ${JSON.stringify(response.body)}`);
  return superMasjidDetailSchema.parse(response.body).removals90d;
};

beforeAll(async () => {
  asSystem = await processUserHandle(harness.testDatabase(), 'mc_system');
  await runDevSeed(asSystem.handle, 'local', NOW);
});

afterAll(async () => {
  await asSystem?.dispose();
});

describe('moderation without a job queue', () => {
  it('remove, restore, clear again and the retention dry run all work and report that nothing was queued', async () => {
    const id = await itemIdOf(seedPublicId('alpha', 1));
    await stepUp(true);
    const removed = await asSuper('post', `/items/${id}/remove`).send({ category: 'other' });
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ publicId: seedPublicId('alpha', 1), cdnPurgeQueued: false });
    const again = await asSuper('post', `/items/${id}/purge`).send({});
    expect(again.body).toEqual({ cdnPurgeQueued: false });
    const restored = await asSuper('post', `/items/${id}/restore`).send({});
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ cdnPurgeQueued: false });
    expect((await asSuper('post', '/retention/dry-run').send({})).body).toEqual({ queued: false });
    // A masjid status change commits too (its purge is skipped).
    expect((await asSuper('post', `/masjids/${ALPHA}/suspend`).send({ reason: 'Test reason' })).status).toBe(204);
    expect((await asSuper('post', `/masjids/${ALPHA}/unsuspend`).send({ reason: 'Test reason' })).status).toBe(204);
  });
});

describe('C2 repeat violations (05 §3)', () => {
  it('counts the masjid’s posts removed in the last 90 days', async () => {
    expect(await removals()).toBe(0);
    await stepUp(true);
    await asSuper('post', `/items/${await itemIdOf(seedPublicId('alpha', 2))}/remove`).send({ category: 'other' });
    await asSuper('post', `/items/${await itemIdOf(seedPublicId('alpha', 3))}/remove`).send({ category: 'hateful' });
    expect(await removals()).toBe(2);
    // Removed 91 days ago: no longer counted.
    await harness
      .db()
      .collection('items')
      .updateMany(
        { public_id: { $in: [seedPublicId('alpha', 2), seedPublicId('alpha', 3)] } },
        { $set: { removed_at: new Date(clock.now().getTime() - 91 * DAY) } },
      );
    expect(await removals()).toBe(0);
  });
});
