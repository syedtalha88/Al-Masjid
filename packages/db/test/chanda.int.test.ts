// PHASE_05 T5.5 — weekly chanda as the real `mc_admin` / `mc_public` users: a week is saved once per week start (the
// masjid's day; never a future week) with its feed item, updated in place afterwards; hidden chanda is never public —
// not in the bundle, the feed, an item link or `v_pub_chanda_weeks`; `setShowChanda` mirrors visibility onto every week
// and chanda item (both ways); notify only while shown; the admin policy cannot write `visible`. Fake amounts only.
import { Long, type UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { getChandaForAdmin, getMasjidBundle, getPublicItem, listFeed } from '../src/repos/index.ts';
import { adminScope, publicScope, systemScope } from '../src/scope.ts';
import { scoped } from '../src/scoped.ts';
import { buildDevSeed, seedId, writeDevSeed } from '../src/seed/index.ts';
import { getPushContent, setChandaSettings, setChandaWeek, setShowChanda } from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { newId, parseId } from '../src/values.ts';

const NOW = new Date('2026-11-10T06:30:00Z'); // a Tuesday (IST); the Friday week started 2026-11-06
const TODAY = '2026-11-10';
const BETA = seedId('masjid-beta'); // Friday weeks, chanda hidden (seed)
const ALPHA = seedId('masjid-alpha');

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
const adminOf = (masjid: UUID) => adminScope({ adminId: newId(), masjids: [{ id: masjid, role: 'owner' }] });
const beta = adminOf(BETA);
const save = (weekStart: string, amountPaise: number, extra: { note?: string; notify?: boolean } = {}) =>
  setChandaWeek(as('admin'), beta, {
    masjidId: BETA,
    weekStart,
    amountPaise,
    notify: extra.notify ?? false,
    ...(extra.note === undefined ? {} : { note: extra.note }),
    now: NOW,
  });
const version = async (id: UUID) =>
  ((await raw('masjids').findOne({ _id: id }, { promoteLongs: false }))?.['content_version'] as Long).toNumber(); // int64
const publicChanda = async () => {
  const bundle = await getMasjidBundle(as('public'), BETA, TODAY);
  if (bundle?.status !== 'active') throw new Error('expected an active bundle');
  const { items } = await listFeed(as('public'), BETA, { type: 'chanda_update', audiences: ['everyone', 'brothers'] });
  const weeks = await scoped({ scope: publicScope(), db: await as('public').db() }, 'v_pub_chanda_weeks').find({
    masjid_id: BETA,
  });
  return { chanda: bundle.chanda, feed: items, view: weeks };
};

beforeAll(async () => {
  test = await createTestDatabase('chanda-state');
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

describe('saving a week', () => {
  it('creates the week and its feed item (hidden while chanda is hidden), bumps the version, audits no amount', async () => {
    const before = await version(BETA);
    const saved = await save('2026-11-06', 1_850_000, { note: 'Test note' });
    expect(saved.created).toBe(true);
    expect(await version(BETA)).toBe(before + 1);
    const week = await raw('chanda_weeks').findOne(
      { masjid_id: BETA, week_start: '2026-11-06' },
      { promoteLongs: false },
    );
    expect(week).toMatchObject({ amount_paise: Long.fromNumber(1_850_000), note: 'Test note', visible: false });
    const item = await raw('items').findOne({ public_id: saved.item.publicId }, { promoteLongs: false });
    expect(item).toMatchObject({
      type: 'chanda_update',
      audience: 'everyone',
      chanda: { week_start: '2026-11-06', amount_paise: Long.fromNumber(1_850_000), visible: false },
    });
    expect(week?.['item_id']).toEqual(item?.['_id']);
    const entry = await raw('audit_log').findOne({ action: 'chanda.save', target_id: saved.weekId });
    expect(entry?.['meta']).toEqual({ week_start: '2026-11-06', notify: false });
  });

  it('saving the same week again updates the week and its one item (marked edited); the note can be removed', async () => {
    const again = await save('2026-11-06', 1_900_000);
    expect(again.created).toBe(false);
    expect(await raw('chanda_weeks').countDocuments({ masjid_id: BETA, week_start: '2026-11-06' })).toBe(1);
    expect(await raw('items').countDocuments({ masjid_id: BETA, type: 'chanda_update' })).toBe(1);
    const week = await raw('chanda_weeks').findOne({ masjid_id: BETA, week_start: '2026-11-06' });
    expect(week?.['note']).toBeUndefined();
    const item = await raw('items').findOne({ public_id: again.item.publicId });
    expect(item?.['chanda']).toMatchObject({ amount_paise: 1_900_000 });
    expect(item?.['edited_at']).toEqual(NOW);
  });

  it('refuses other days, future weeks, bad amounts and notes, notify while hidden, and other masjids', async () => {
    expect(await code(save('2026-11-07', 100))).toBe('CHANDA_INVALID'); // a Saturday
    expect(await code(save('2026-11-13', 100))).toBe('CHANDA_INVALID'); // next week
    expect(await code(save('2026-02-30', 100))).toBe('CHANDA_INVALID');
    expect(await code(save('2026-10-30', -1))).toBe('CHANDA_INVALID');
    expect(await code(save('2026-10-30', 10.5))).toBe('CHANDA_INVALID');
    expect(await code(save('2026-10-30', 100, { note: 'x'.repeat(201) }))).toBe('CHANDA_INVALID');
    expect(await code(save('2026-10-30', 100, { notify: true }))).toBe('CHANDA_HIDDEN');
    expect(
      await code(
        setChandaWeek(as('admin'), adminOf(ALPHA), {
          masjidId: BETA,
          weekStart: '2026-10-30',
          amountPaise: 1,
          notify: false,
        }),
      ),
    ).toBe('MASJID_NOT_FOUND');
  });
});

describe('hidden chanda is never public; setShowChanda mirrors both ways', () => {
  it('while hidden: no bundle chanda, no feed item, no item link, nothing in v_pub_chanda_weeks', async () => {
    await save('2026-10-30', 1_200_000);
    const hidden = await publicChanda();
    expect(hidden).toEqual({ chanda: null, feed: [], view: [] });
    const { item } = await save('2026-10-23', 900_000);
    expect(await getPublicItem(as('public'), item.publicId, ['everyone', 'brothers'])).toBeNull();
  });

  it('shown: every week and chanda item turns visible; the bundle has the weeks oldest first; notify works', async () => {
    const before = await version(BETA);
    await setShowChanda(as('admin'), beta, BETA, true, { now: NOW });
    expect(await version(BETA)).toBe(before + 1);
    expect(await raw('chanda_weeks').countDocuments({ masjid_id: BETA, visible: false })).toBe(0);
    expect(await raw('items').countDocuments({ masjid_id: BETA, type: 'chanda_update', 'chanda.visible': false })).toBe(
      0,
    );
    const shown = await publicChanda();
    expect(shown.chanda?.weeks).toEqual([
      { weekStart: '2026-10-23', amountPaise: 900_000 },
      { weekStart: '2026-10-30', amountPaise: 1_200_000 },
      { weekStart: '2026-11-06', amountPaise: 1_900_000 },
    ]);
    // Feed order is by publish time (all equal here): compare as a set, by week.
    expect(
      shown.feed.map((entry) => entry.chanda).sort((a, b) => (a?.weekStart ?? '').localeCompare(b?.weekStart ?? '')),
    ).toEqual(shown.chanda?.weeks);
    const notified = await save('2026-10-16', 500_000, { notify: true });
    expect(notified.notificationJobId).not.toBeNull();
    // T5.6: the notification says the week and its total.
    expect(await getPushContent(as('system'), systemScope(), parseId(notified.item.id) ?? newId())).toMatchObject({
      type: 'chanda_update',
      chanda: { weekStart: '2026-10-16', amountPaise: 500_000 },
      campaign: undefined,
    });
    // A new week while shown is visible at once.
    expect((await publicChanda()).view).toHaveLength(4);
    expect(await raw('audit_log').findOne({ action: 'chanda.settings', masjid_id: BETA })).toMatchObject({
      meta: { show: true },
    });
  });

  it('hidden again: everything disappears from public reads at once', async () => {
    await setShowChanda(as('admin'), beta, BETA, false, { now: NOW });
    expect(await publicChanda()).toEqual({ chanda: null, feed: [], view: [] });
    expect(await raw('chanda_weeks').countDocuments({ masjid_id: BETA, visible: true })).toBe(0);
  });

  it('only the state function writes `visible`: the admin policy refuses it on weeks', async () => {
    const db = await as('admin').db();
    await expect(
      scoped({ scope: beta, db }, 'chanda_weeks').updateOne({ masjid_id: BETA }, { $set: { visible: true } }),
    ).rejects.toThrow();
  });
});

describe('settings', () => {
  it('week start 1–7; nothing to change is refused; the admin list shows settings and weeks newest first', async () => {
    expect(await code(setChandaSettings(as('admin'), beta, { masjidId: BETA, weekStart: 0 }))).toBe('CHANDA_INVALID');
    expect(await code(setChandaSettings(as('admin'), beta, { masjidId: BETA, weekStart: 8 }))).toBe('CHANDA_INVALID');
    expect(await code(setChandaSettings(as('admin'), beta, { masjidId: BETA }))).toBe('NOTHING_TO_UPDATE');
    await setChandaSettings(as('admin'), beta, { masjidId: BETA, weekStart: 1, now: NOW });
    const listed = await getChandaForAdmin(as('admin'), beta, BETA);
    expect(listed).toMatchObject({ show: false, weekStart: 1 });
    expect(listed.weeks.map((week) => week.weekStart)).toEqual([
      '2026-11-06',
      '2026-10-30',
      '2026-10-23',
      '2026-10-16',
    ]);
    // Monday weeks from now on: a Friday is no longer a week start, the Monday of this week is.
    expect(await code(save('2026-11-06', 100))).toBe('CHANDA_INVALID');
    expect(await code(save('2026-11-09', 100))).toBe('ok');
    expect(await code(getChandaForAdmin(as('admin'), adminOf(ALPHA), BETA))).toBe('MASJID_NOT_FOUND');
  });
});
