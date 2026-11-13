// PHASE_08 T8.2 — takedown in the data layer as the real users: only a stepped-up Super Admin removes / restores;
// removal hides the post from the public view at once, keeps it (with the private note) for the Super Admin, shows the
// masjid's admins the category but never the note or the content, marks it for the 180-day purge and closes its open
// reports; no generic write can set `removed` / `hidden` or the moderation fields; restore undoes all of it (and
// dismisses the reports that auto-hid a post); the queue counts the masjid's removals in 90 days; a chanda post taken
// down takes its week's public figures and note with it, and nothing brings them back but a restore (#180 M6).
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
  mediaForTakedown,
  registerDevice,
  removeItem,
  restoreItem,
  setChandaSettings,
  setChandaWeek,
} from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { newId } from '../src/values.ts';

const NOW = new Date('2026-11-13T06:30:00Z');
const ALPHA = seedId('masjid-alpha');
const DELTA = seedId('masjid-delta');
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

  it('an urgent report is dismissed only with a fresh step-up (#180 L3)', async () => {
    const reportId = await reportOn(seedPublicId('alpha', 2));
    await t()
      .db.collection<{ _id: UUID }>('reports')
      .updateOne({ _id: reportId }, { $set: { urgent: true } });
    expect(await code(dismissReport(as('mc_admin'), superScope(SUPER), { reportId, now: NOW }))).toBe(
      'STEP_UP_REQUIRED',
    );
    expect(await t().db.collection<{ _id: UUID }>('reports').findOne({ _id: reportId })).toMatchObject({
      status: 'open',
    });
    await dismissReport(as('mc_admin'), stepped(), { reportId, now: NOW });
    expect(await t().db.collection<{ _id: UUID }>('reports').findOne({ _id: reportId })).toMatchObject({
      status: 'dismissed',
    });
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

  it('F73: the direction follows the post — not published: only files no published post also uses are restricted; published: all of them (M1)', async () => {
    const key = `m/${String(ALPHA)}/${String(newId())}`;
    const removedId = await itemOf(seedPublicId('alpha', 4));
    const liveId = await itemOf(seedPublicId('alpha', 5));
    const items = t().db.collection<{ _id: UUID }>('items');
    const before = await t()
      .db.collection<{ _id: UUID; status: string }>('items')
      .findOne({ _id: removedId }, { projection: { status: 1 } });
    await items.updateOne({ _id: removedId }, { $set: { image_key: key, status: 'removed' } });
    await items.updateOne({ _id: liveId }, { $set: { image_key: key } });
    const takedown = () => mediaForTakedown(as('mc_system'), systemScope(), { itemId: removedId });
    // Shared with a published post: it must keep working.
    expect(await takedown()).toEqual({ images: [], audio: [], restrict: true });
    await items.updateOne({ _id: liveId }, { $unset: { image_key: '' } });
    expect(await takedown()).toEqual({ images: [key], audio: [], restrict: true });
    // Hidden counts as not published too; only a published post gets its files back.
    await items.updateOne({ _id: removedId }, { $set: { status: 'hidden' } });
    expect(await takedown()).toEqual({ images: [key], audio: [], restrict: true });
    await items.updateOne({ _id: removedId }, { $set: { status: 'published' } });
    expect(await takedown()).toEqual({ images: [key], audio: [], restrict: false });
    expect(await code(mediaForTakedown(as('mc_admin'), stepped(), { itemId: removedId }))).toBe('FORBIDDEN');
    await items.updateOne({ _id: removedId }, { $set: { status: before?.status ?? 'published' } });
  });
});

describe('chanda posts taken down (#180 M6)', () => {
  const deltaAdmin = adminScope({ adminId: newId(), masjids: [{ id: DELTA, role: 'owner' }] });
  type Week = { _id: UUID; week_start: string; item_id: UUID; visible: boolean; amount_paise: unknown };
  const weeks = () => t().db.collection<Week>('chanda_weeks');
  /** Week starts in the public view (what the musalli app reads). */
  const publicWeeks = async () =>
    (
      await t()
        .db.collection<{ masjid_id: UUID; week_start: string }>('v_pub_chanda_weeks')
        .find({ masjid_id: DELTA })
        .toArray()
    )
      .map((row) => row.week_start)
      .sort();
  const chandaItems = () => t().db.collection('items').countDocuments({ masjid_id: DELTA, type: 'chanda_update' });
  const latestWeek = async () => {
    const week = await weeks().findOne({ masjid_id: DELTA }, { sort: { week_start: -1 } });
    if (!week) throw new Error('no seeded chanda week');
    return week;
  };

  it('removed: the week leaves the public view; showing chanda again and saving the week never bring it back; restore does', async () => {
    const week = await latestWeek();
    expect(await publicWeeks()).toContain(week.week_start);
    await removeItem(as('mc_admin'), stepped(), { itemId: week.item_id, category: 'other', now: NOW });
    expect(await weeks().findOne({ _id: week._id })).toMatchObject({ visible: false });
    expect(await publicWeeks()).not.toContain(week.week_start);
    const others = (await publicWeeks()).length;
    expect(others).toBeGreaterThan(0);

    // "Show chanda" off and on again: every other week returns, the removed one stays hidden.
    await setChandaSettings(as('mc_admin'), deltaAdmin, { masjidId: DELTA, show: false, now: NOW });
    expect(await publicWeeks()).toEqual([]);
    await setChandaSettings(as('mc_admin'), deltaAdmin, { masjidId: DELTA, show: true, now: NOW });
    expect(await publicWeeks()).toHaveLength(others);
    expect(await publicWeeks()).not.toContain(week.week_start);

    // Saving the week again is refused — it would publish a new post in place of the removed one.
    const posts = await chandaItems();
    const save = { masjidId: DELTA, weekStart: week.week_start, amountPaise: 100, notify: false, now: NOW };
    expect(await code(setChandaWeek(as('mc_admin'), deltaAdmin, save))).toBe('ITEM_ALREADY_REMOVED');
    expect(await chandaItems()).toBe(posts);
    expect(await weeks().findOne({ _id: week._id })).toMatchObject({ amount_paise: week.amount_paise });

    await restoreItem(as('mc_admin'), stepped(), { itemId: week.item_id, now: NOW });
    expect(await weeks().findOne({ _id: week._id })).toMatchObject({ visible: true });
    expect(await publicWeeks()).toContain(week.week_start);
  });

  it('auto-hidden: hidden with its post; a save keeps the figures but publishes nothing; notify is refused', async () => {
    const week = await latestWeek();
    await autoHideItem(as('mc_system'), systemScope(), { itemId: week.item_id, reporters: 10, now: NOW });
    expect(await publicWeeks()).not.toContain(week.week_start);
    const posts = await chandaItems();
    const save = { masjidId: DELTA, weekStart: week.week_start, amountPaise: 4_200, notify: false, now: NOW };
    expect(await setChandaWeek(as('mc_admin'), deltaAdmin, save)).toMatchObject({ created: false });
    expect(await chandaItems()).toBe(posts);
    expect(await t().db.collection<{ _id: UUID }>('items').findOne({ _id: week.item_id })).toMatchObject({
      status: 'hidden',
    });
    expect(await publicWeeks()).not.toContain(week.week_start);
    expect(await code(setChandaWeek(as('mc_admin'), deltaAdmin, { ...save, notify: true }))).toBe('CHANDA_HIDDEN');

    // Restored: public again (Delta shows its chanda).
    await restoreItem(as('mc_admin'), stepped(), { itemId: week.item_id, now: NOW });
    expect(await publicWeeks()).toContain(week.week_start);
  });

  it('a restore while the masjid hides its chanda keeps the week hidden', async () => {
    const week = await latestWeek();
    await removeItem(as('mc_admin'), stepped(), { itemId: week.item_id, category: 'other', now: NOW });
    await setChandaSettings(as('mc_admin'), deltaAdmin, { masjidId: DELTA, show: false, now: NOW });
    await restoreItem(as('mc_admin'), stepped(), { itemId: week.item_id, now: NOW });
    expect(await weeks().findOne({ _id: week._id })).toMatchObject({ visible: false });
    await setChandaSettings(as('mc_admin'), deltaAdmin, { masjidId: DELTA, show: true, now: NOW });
    expect(await publicWeeks()).toContain(week.week_start);
  });
});
