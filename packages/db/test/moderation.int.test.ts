// PHASE_08 T8.2 — takedown in the data layer as the real users: only a stepped-up Super Admin removes / restores;
// removal hides the post from the public view at once, keeps it (with the private note) for the Super Admin, shows the
// masjid's admins the category but never the note or the content, marks it for the 180-day purge and closes its open
// reports; no generic write can set `removed` / `hidden` or the moderation fields; restore undoes all of it (and
// dismisses the reports that auto-hid a post); the queue counts the masjid's removals in 90 days.
import { createHash, randomBytes } from 'node:crypto';

import type { UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { getPublicItem, listModerationQueue } from '../src/repos/index.ts';
import { adminScope, deviceScope, publicScope, superScope, systemScope } from '../src/scope.ts';
import { scoped } from '../src/scoped.ts';
import { buildDevSeed, seedId, seedPublicId, writeDevSeed } from '../src/seed/index.ts';
import {
  autoHideItem,
  createReport,
  dismissReport,
  registerDevice,
  removeItem,
  restoreItem,
} from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { newId } from '../src/values.ts';

const NOW = new Date('2026-11-13T06:30:00Z');
const ALPHA = seedId('masjid-alpha');
const SUPER = newId();
const ALL = ['everyone', 'brothers', 'sisters'] as const;
const stepped = () => superScope(SUPER, NOW);
const admin = () => adminScope({ adminId: newId(), masjids: [{ id: ALPHA, role: 'owner' }] });

let test: TestDatabase | undefined;
const handles: Partial<Record<'mc_admin' | 'mc_system' | 'mc_public', Awaited<ReturnType<typeof processUserHandle>>>> =
  {};
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const as = (user: 'mc_admin' | 'mc_system' | 'mc_public'): DbHandle => {
  const found = handles[user];
  if (!found) throw new Error(`no ${user} handle`);
  return found.handle;
};
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof StateError) return error.code;
    throw error;
  }
};
const itemOf = async (publicId: string) => {
  const doc = await t().db.collection<{ _id: UUID }>('items').findOne({ public_id: publicId });
  if (!doc) throw new Error(`no ${publicId}`);
  return doc._id;
};
const reportOn = async (publicId: string) => {
  const device = await registerDevice(as('mc_public'), publicScope(), {
    secretHash: createHash('sha256').update(randomBytes(32)).digest(),
    locale: 'en',
    audiencePref: 'brothers',
    platform: 'android',
    privacyVersion: 'draft-1',
    now: NOW,
  });
  return createReport(as('mc_public'), deviceScope(device), {
    target: { kind: 'item', publicId },
    reason: 'other',
    urgent: false,
    slaDueAt: new Date(NOW.getTime() + 36 * 3_600_000),
    now: NOW,
  });
};

beforeAll(async () => {
  test = await createTestDatabase('moderation-state');
  await runMigrations(t().db, MIGRATIONS);
  for (const user of ['mc_admin', 'mc_system', 'mc_public'] as const) {
    handles[user] = await processUserHandle(t(), user);
  }
  await writeDevSeed(as('mc_system'), systemScope(), buildDevSeed({ now: NOW, today: '2026-11-13' }));
});

afterAll(async () => {
  for (const found of Object.values(handles)) await found.dispose();
  await test?.dispose();
});

describe('removeItem / restoreItem / dismissReport', () => {
  it('only a stepped-up Super Admin', async () => {
    const id = await itemOf(seedPublicId('alpha', 0));
    const input = { itemId: id, category: 'other', now: NOW };
    expect(await code(removeItem(as('mc_admin'), admin(), input))).toBe('FORBIDDEN');
    expect(await code(removeItem(as('mc_admin'), superScope(SUPER), input))).toBe('STEP_UP_REQUIRED');
    expect(await code(restoreItem(as('mc_admin'), superScope(SUPER), { itemId: id, now: NOW }))).toBe(
      'STEP_UP_REQUIRED',
    );
    expect(await code(dismissReport(as('mc_admin'), admin(), { reportId: newId(), now: NOW }))).toBe('FORBIDDEN');
  });

  it('removal: gone from the public at once, preserved for the Super Admin, category only for the masjid', async () => {
    const publicId = seedPublicId('alpha', 0);
    const id = await itemOf(publicId);
    await reportOn(publicId);
    const removed = await removeItem(as('mc_admin'), stepped(), {
      itemId: id,
      category: 'hateful',
      note: 'Placeholder note',
      now: NOW,
    });
    expect(removed).toMatchObject({ publicId, reportsClosed: 1 });
    expect(await getPublicItem(as('mc_public'), publicId, [...ALL])).toBeNull();
    const [kept] = await scoped({ scope: stepped(), db: await as('mc_admin').db() }, 'items').find({ _id: id });
    expect(kept).toMatchObject({ status: 'removed', removed_reason: 'hateful', removed_note: 'Placeholder note' });
    expect(kept?.['purge_after']).toEqual(new Date(NOW.getTime() + 180 * 24 * 3_600_000));
    const [seen] = await scoped({ scope: admin(), db: await as('mc_admin').db() }, 'items').find({ _id: id });
    expect(seen).toMatchObject({ status: 'removed', removed_reason: 'hateful' });
    expect(seen).not.toHaveProperty('removed_note');
    expect(seen).not.toHaveProperty('title');
    expect(seen).not.toHaveProperty('body');
    expect(await code(removeItem(as('mc_admin'), stepped(), { itemId: id, category: 'other', now: NOW }))).toBe(
      'ITEM_ALREADY_REMOVED',
    );
    expect(await code(removeItem(as('mc_admin'), stepped(), { itemId: newId(), category: 'other', now: NOW }))).toBe(
      'ITEM_NOT_FOUND',
    );
  });

  it('no generic write can set the moderation status or fields', async () => {
    const id = await itemOf(seedPublicId('alpha', 2));
    const asAdmin = scoped({ scope: admin(), db: await as('mc_admin').db() }, 'items');
    const asSuper = scoped({ scope: stepped(), db: await as('mc_admin').db() }, 'items');
    for (const fields of [{ status: 'hidden' }, { status: 'removed' }, { removed_note: 'x' }, { hidden_at: NOW }]) {
      await expect(asAdmin.updateOne({ _id: id }, { $set: fields })).rejects.toThrow();
      await expect(asSuper.updateOne({ _id: id }, { $set: fields })).rejects.toThrow();
    }
  });

  it('restore: a removed post is published again with every moderation field cleared', async () => {
    const publicId = seedPublicId('alpha', 0);
    const id = await itemOf(publicId);
    expect(await restoreItem(as('mc_admin'), stepped(), { itemId: id, now: NOW })).toMatchObject({ publicId });
    const doc = await t().db.collection<{ _id: UUID }>('items').findOne({ _id: id });
    expect(doc).toMatchObject({ status: 'published' });
    for (const field of ['removed_at', 'removed_reason', 'removed_note', 'purge_after', 'hidden_at']) {
      expect(doc).not.toHaveProperty(field);
    }
    expect(await getPublicItem(as('mc_public'), publicId, [...ALL])).not.toBeNull();
    expect(await code(restoreItem(as('mc_admin'), stepped(), { itemId: id, now: NOW }))).toBe('ITEM_NOT_FOUND');
  });

  it('restoring an auto-hidden post dismisses the reports that hid it', async () => {
    const publicId = seedPublicId('alpha', 3);
    const id = await itemOf(publicId);
    const reportId = await reportOn(publicId);
    await autoHideItem(as('mc_system'), systemScope(), { itemId: id, reporters: 10, now: NOW });
    expect(await restoreItem(as('mc_admin'), stepped(), { itemId: id, now: NOW })).toMatchObject({
      reportsDismissed: 1,
    });
    expect(await t().db.collection<{ _id: UUID }>('reports').findOne({ _id: reportId })).toMatchObject({
      status: 'dismissed',
    });
  });

  it('dismiss closes one open report once', async () => {
    const reportId = await reportOn(seedPublicId('alpha', 2));
    await dismissReport(as('mc_admin'), superScope(SUPER), { reportId, note: 'Placeholder', now: NOW });
    expect(await t().db.collection<{ _id: UUID }>('reports').findOne({ _id: reportId })).toMatchObject({
      status: 'dismissed',
      resolution_note: 'Placeholder',
    });
    expect(await code(dismissReport(as('mc_admin'), superScope(SUPER), { reportId, now: NOW }))).toBe(
      'REPORT_NOT_FOUND',
    );
  });

  it('the queue: grouped per post, urgent first, the 90-day removal count, Super Admin only', async () => {
    const publicId = seedPublicId('alpha', 2);
    await reportOn(publicId);
    // The restored post's removal is no longer on record; one more removal is.
    await removeItem(as('mc_admin'), stepped(), {
      itemId: await itemOf(seedPublicId('alpha', 1)),
      category: 'other',
      now: NOW,
    });
    const queue = await listModerationQueue(as('mc_admin'), superScope(SUPER), {
      status: 'open',
      now: NOW,
      windowMs: 90 * 24 * 3_600_000,
    });
    const target = queue.find((entry) => entry.item?.publicId === publicId);
    expect(target).toMatchObject({ targetType: 'item', itemStatus: 'published' });
    expect(target?.masjid.removals90d).toBe(1);
    expect(await code(listModerationQueue(as('mc_admin'), admin(), { status: 'open', now: NOW, windowMs: 1 }))).toBe(
      'FORBIDDEN',
    );
  });
});
