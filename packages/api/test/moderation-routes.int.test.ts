// PHASE_08 T8.2 — the Super Admin's moderation routes through the real app (mc_admin): the queue groups reports by
// post, urgent first; ★ Remove needs a step-up, takes the post away from the public at once (public view, feed
// version), closes its reports, tells the masjid's admins (alert) and queues the CDN purge of `i-<publicId>` and
// `m-<masjidId>`; a second removal is 409; the admin sees the category, never the note; ★ Restore brings it back;
// Dismiss closes one report; masjid admins never reach any of it. Placeholder text only (10 §Fixtures).
import { createHash, randomBytes } from 'node:crypto';

import { adminScope, deviceScope, idText, isId, newId, publicScope } from '@mc/db';
import { getPublicItem, listItemsForAdmin } from '@mc/db/repos';
import { seedId, seedPublicId } from '@mc/db/seed';
import { createReport, registerDevice, type ReportReasonValue } from '@mc/db/state';
import { processUserHandle } from '@mc/db/testing';
import { reportSla } from '@mc/shared/compliance';
import { moderationQueueSchema, moderationResultSchema } from '@mc/shared/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runDevSeed } from '../src/jobs/seed.ts';
import type { AlertService } from '../src/queue/alerts.ts';
import type { CdnPurgeService } from '../src/queue/cdn.ts';
import { superHarness } from './super-harness.ts';

const NOW = new Date('2026-11-13T06:30:00Z');
const ALPHA = seedId('masjid-alpha');
const OWNER = newId();
const raised: Parameters<AlertService['raise']>[0][] = [];
const purges: { tags: readonly string[]; key: string }[] = [];
let purgeWorks = true;
const alerts: AlertService = {
  raise: (input) => {
    raised.push(input);
    return Promise.resolve(true);
  },
};
const access: { itemId: string; restrict: boolean }[] = [];
const cdn: CdnPurgeService = {
  purgeTags: (tags, key) => {
    purges.push({ tags, key });
    return Promise.resolve(purgeWorks);
  },
  mediaAccess: (itemId, restrict) => {
    access.push({ itemId, restrict });
    return Promise.resolve(true);
  },
};
const harness = superHarness('moderation-routes', NOW, { alerts, cdn });
const { asSuper, stepUp, clock } = harness;

let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asPublic: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const pub = () => {
  if (!asPublic) throw new Error('no mc_public handle');
  return asPublic.handle;
};
const itemIdOf = async (publicId: string) => {
  const id: unknown = (await harness.db().collection('items').findOne({ public_id: publicId }))?.['_id'];
  if (!isId(id)) throw new Error(`no item ${publicId}`);
  return idText(id);
};
const report = async (publicId: string, reason: ReportReasonValue) => {
  const device = await registerDevice(pub(), publicScope(), {
    secretHash: createHash('sha256').update(randomBytes(32)).digest(),
    locale: 'en',
    audiencePref: 'brothers',
    platform: 'android',
    privacyVersion: 'draft-1',
    now: clock.now(),
  });
  return createReport(pub(), deviceScope(device), {
    target: { kind: 'item', publicId },
    reason,
    ...reportSla(reason, clock.now()),
    now: clock.now(),
  });
};

beforeAll(async () => {
  asSystem = await processUserHandle(harness.testDatabase(), 'mc_system');
  asPublic = await processUserHandle(harness.testDatabase(), 'mc_public');
  await runDevSeed(asSystem.handle, 'local', NOW);
  // The dev seed has no masjid admins: one owner for Alpha, who is told about a removal.
  await harness
    .db()
    .collection<{ _id: ReturnType<typeof newId> } & Record<string, unknown>>('masjid_admins')
    .insertOne({
      _id: newId(),
      masjid_id: ALPHA,
      admin_id: OWNER,
      role: 'owner',
      added_by: OWNER,
      created_at: NOW,
    });
});

afterAll(async () => {
  await asSystem?.dispose();
  await asPublic?.dispose();
});

describe('moderation (C5)', () => {
  it('the queue groups reports by post, urgent first, with the post as musallis see it', async () => {
    await report(seedPublicId('alpha', 0), 'misleading');
    await report(seedPublicId('alpha', 0), 'other');
    await report(seedPublicId('alpha', 2), 'private_info');
    const response = await asSuper('get', '/reports');
    expect(response.status).toBe(200);
    const { targets } = moderationQueueSchema.parse(response.body);
    expect(targets.map((target) => target.item?.publicId)).toEqual([
      seedPublicId('alpha', 2),
      seedPublicId('alpha', 0),
    ]);
    expect(targets[0]).toMatchObject({ urgent: true, itemStatus: 'published', masjid: { removals90d: 0 } });
    expect(targets[1]?.reports).toHaveLength(2);
    expect(JSON.stringify(response.body)).not.toContain('device');
  });

  it('★ Remove needs a step-up; then the post is gone for everyone, reports closed, admins told, CDN purged', async () => {
    const publicId = seedPublicId('alpha', 0);
    const id = await itemIdOf(publicId);
    await stepUp(false);
    expect((await asSuper('post', `/items/${id}/remove`).send({ category: 'misleading' })).status).toBe(403);
    await stepUp(true);
    const response = await asSuper('post', `/items/${id}/remove`).send({
      category: 'misleading',
      note: 'Placeholder moderator note',
    });
    expect(response.status).toBe(200);
    expect(moderationResultSchema.parse(response.body)).toEqual({ publicId, reports: 2, cdnPurgeQueued: true });
    expect(await getPublicItem(pub(), publicId, ['everyone', 'brothers', 'sisters'])).toBeNull();
    expect(purges.at(-1)?.tags).toEqual([`i-${publicId}`, `m-${idText(ALPHA)}`]);
    expect(access.at(-1)).toEqual({ itemId: id, restrict: true }); // F73: its files stop being delivered
    expect(raised.at(-1)).toMatchObject({ type: 'item_removed', to: { kind: 'admins', adminIds: [idText(OWNER)] } });
    const open = await asSuper('get', '/reports');
    const queue = moderationQueueSchema.parse(open.body);
    expect(queue.targets.some((target) => target.item?.publicId === publicId)).toBe(false);
    const actioned = moderationQueueSchema.parse((await asSuper('get', '/reports?status=actioned')).body);
    expect(actioned.targets.find((target) => target.item?.publicId === publicId)).toMatchObject({
      itemStatus: 'removed',
      removedReason: 'misleading',
      masjid: { removals90d: 1 },
    });
    expect((await asSuper('post', `/items/${id}/remove`).send({ category: 'misleading' })).status).toBe(409);
  });

  it('the masjid sees the category, never the private note (preserved for the Super Admin only)', async () => {
    const id = await itemIdOf(seedPublicId('alpha', 0));
    const stored = await harness
      .db()
      .collection('items')
      .findOne({ public_id: seedPublicId('alpha', 0) });
    expect(stored).toMatchObject({ status: 'removed', removed_note: 'Placeholder moderator note' });
    expect(stored?.['purge_after']).toBeInstanceOf(Date);
    const asAdmin = await processUserHandle(harness.testDatabase(), 'mc_admin');
    const page = await listItemsForAdmin(
      asAdmin.handle,
      adminScope({ adminId: seedId('admin'), masjids: [{ id: ALPHA, role: 'owner' }] }),
      ALPHA,
      { status: 'removed', now: clock.now() },
    );
    await asAdmin.dispose();
    const row = page.rows.find((entry) => entry.id === id);
    expect(row).toMatchObject({ status: 'removed', removedReason: 'misleading' });
    expect(JSON.stringify(row)).not.toContain('Placeholder moderator note');
  });

  it('a purge that could not be queued is reported, and can be asked for again', async () => {
    const publicId = seedPublicId('alpha', 3);
    const id = await itemIdOf(publicId);
    purgeWorks = false;
    const response = await asSuper('post', `/items/${id}/remove`).send({ category: 'copyright' });
    expect(response.body).toMatchObject({ cdnPurgeQueued: false });
    purgeWorks = true;
    const again = await asSuper('post', `/items/${publicId}/purge?masjid=${idText(ALPHA)}&item=${id}`);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ cdnPurgeQueued: true });
    expect(access.at(-1)).toEqual({ itemId: id, restrict: true });
  });

  it('★ Restore publishes it again; Dismiss closes one report', async () => {
    const publicId = seedPublicId('alpha', 3);
    const id = await itemIdOf(publicId);
    const restored = await asSuper('post', `/items/${id}/restore`);
    expect(restored.status).toBe(200);
    expect(access.at(-1)).toEqual({ itemId: id, restrict: false });
    expect(await getPublicItem(pub(), publicId, ['everyone', 'brothers', 'sisters'])).not.toBeNull();
    expect((await asSuper('post', `/items/${id}/restore`)).status).toBe(404);

    const reportId = idText(await report(seedPublicId('alpha', 2), 'other'));
    expect((await asSuper('post', `/reports/${reportId}/dismiss`).send({ note: 'Placeholder' })).status).toBe(200);
    expect((await asSuper('post', `/reports/${reportId}/dismiss`).send({})).status).toBe(404);
  });

  it('refuses bad input', async () => {
    const id = await itemIdOf(seedPublicId('alpha', 2));
    expect((await asSuper('post', `/items/${id}/remove`).send({ category: 'boring' })).status).toBe(400);
    expect((await asSuper('post', `/items/${id}/remove`).send({ category: 'other', extra: 1 })).status).toBe(400);
    expect((await asSuper('post', '/items/not-an-id/remove').send({ category: 'other' })).status).toBe(404);
    expect((await asSuper('get', '/reports?status=everything')).status).toBe(400);
  });
});
