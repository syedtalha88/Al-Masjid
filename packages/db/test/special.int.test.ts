// PHASE_03 T3.3 — special dates and Ramadan mode as the real `mc_admin` user: the `@mc/domain/special` rules (1–5
// times, dates within ±400 days, Ramadan start ≤ end and ≤ 30 days), the version bump and audit entry, replace and soft
// delete (the public view drops the entry), "Notify followers" (a `timing_update` item + pending outbox job) and the
// tenant fence — another masjid's entries answer like unknown ones.
import type { Long, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { getMasjidBundle, getRamadan, listSpecialDates } from '../src/repos/index.ts';
import { adminScope, systemScope } from '../src/scope.ts';
import { buildDevSeed, seedId, writeDevSeed } from '../src/seed/index.ts';
import { deleteSpecialDate, saveRamadan, saveSpecialDate, type SpecialDateInput } from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { newId, parseId } from '../src/values.ts';

const NOW = new Date('2026-11-03T06:30:00Z'); // 12:00 IST
const TODAY = '2026-11-03';
const ALPHA = seedId('masjid-alpha');
const BETA = seedId('masjid-beta');

let test: TestDatabase | undefined;
let asAdmin: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asPublic: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const adm = (): DbHandle => {
  if (!asAdmin) throw new Error('no mc_admin handle');
  return asAdmin.handle;
};
const pub = (): DbHandle => {
  if (!asPublic) throw new Error('no mc_public handle');
  return asPublic.handle;
};
const raw = (name: string) => t().db.collection<{ _id: UUID | string } & Record<string, unknown>>(name);
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof StateError) return error.code;
    throw error;
  }
};
const ADMIN_ID = newId();
const adminOf = (...masjids: UUID[]) =>
  adminScope({ adminId: ADMIN_ID, masjids: masjids.map((id) => ({ id, role: 'owner' as const })) });
const version = async (id: UUID) => {
  const masjid = await raw('masjids').findOne({ _id: id }, { promoteLongs: false });
  return (masjid?.['content_version'] as Long).toNumber(); // int64 by schema
};
const idOf = (text: string): UUID => {
  const id = parseId(text);
  if (!id) throw new Error(`not an id: ${text}`);
  return id;
};

const EID: SpecialDateInput = {
  type: 'eid_ul_adha',
  date: '2026-11-20',
  label: 'Test label',
  times: [{ time: '07:30', label: 'Test slot one' }, { time: '08:30' }],
  note: 'Test note',
};
const save = (entry: SpecialDateInput, extra: { id?: UUID; notify?: boolean; masjidId?: UUID } = {}) =>
  saveSpecialDate(adm(), adminOf(ALPHA), {
    masjidId: extra.masjidId ?? ALPHA,
    entry,
    notify: extra.notify ?? false,
    now: NOW,
    ...(extra.id ? { id: extra.id } : {}),
  });

beforeAll(async () => {
  test = await createTestDatabase('special-state');
  await runMigrations(t().db, MIGRATIONS);
  asAdmin = await processUserHandle(t(), 'mc_admin');
  asSystem = await processUserHandle(t(), 'mc_system');
  asPublic = await processUserHandle(t(), 'mc_public');
  await writeDevSeed(asSystem.handle, systemScope(), buildDevSeed({ now: NOW, today: TODAY }));
});

afterAll(async () => {
  await asAdmin?.dispose();
  await asSystem?.dispose();
  await asPublic?.dispose();
  await test?.dispose();
});

describe('saveSpecialDate', () => {
  it('adds an entry: stored shape, version bump, audit entry; the admin list and the musalli bundle show it', async () => {
    const before = await version(ALPHA);
    const result = await save(EID);
    expect(result.item).toBeNull();
    const stored = await raw('special_timings').findOne({ _id: idOf(result.id) });
    expect(stored).toMatchObject({
      masjid_id: ALPHA,
      type: 'eid_ul_adha',
      date: '2026-11-20',
      label: 'Test label',
      times: [{ time: '07:30', label: 'Test slot one' }, { time: '08:30' }],
      note: 'Test note',
      masjid_visible: true,
      created_by: ADMIN_ID,
    });
    expect(await version(ALPHA)).toBe(before + 1);
    expect(
      await raw('audit_log').findOne({ action: 'special.create', target_id: result.id }, { sort: { _id: -1 } }),
    ).toMatchObject({ masjid_id: ALPHA, meta: { type: 'eid_ul_adha', notify: false } });

    const listed = await listSpecialDates(adm(), adminOf(ALPHA), ALPHA, TODAY);
    expect(listed.find((entry) => entry.id === result.id)).toEqual({ id: result.id, ...EID });
    const bundle = await getMasjidBundle(pub(), ALPHA, TODAY);
    expect(bundle?.status === 'active' && bundle.specialDates.some((entry) => entry.id === result.id)).toBe(true);
  });

  it('replaces an entry: a label or note left out is removed', async () => {
    const { id } = await save(EID);
    const before = await version(ALPHA);
    await save({ type: 'taraweeh', date: '2026-11-21', times: [{ time: '21:30' }] }, { id: idOf(id) });
    const stored = await raw('special_timings').findOne({ _id: idOf(id) });
    expect(stored).toMatchObject({ type: 'taraweeh', date: '2026-11-21', times: [{ time: '21:30' }] });
    expect(stored).not.toHaveProperty('label');
    expect(stored).not.toHaveProperty('note');
    expect(await version(ALPHA)).toBe(before + 1);
    expect(await raw('audit_log').findOne({ action: 'special.update', target_id: id })).toMatchObject({
      meta: { type: 'taraweeh', notify: false },
    });
  });

  it('refuses 0 or 6 times, a time twice and dates more than 400 days away — nothing written', async () => {
    const count = await raw('special_timings').countDocuments({ masjid_id: ALPHA });
    const before = await version(ALPHA);
    const times = (n: number) => Array.from({ length: n }, (_, i) => ({ time: `0${String(i + 1)}:00` }));
    for (const entry of [
      { ...EID, times: [] },
      { ...EID, times: times(6) },
      { ...EID, times: [{ time: '07:30' }, { time: '07:30' }] },
      { ...EID, date: '2027-12-09' }, // today + 401
      { ...EID, date: '2025-09-28' }, // today − 401
    ]) {
      expect(await code(save(entry))).toBe('SPECIAL_DATE_INVALID');
    }
    // The window's ends are allowed.
    expect(await code(save({ ...EID, date: '2027-12-08', times: times(5) }))).toBe('ok');
    expect(await code(save({ ...EID, date: '2025-09-29' }))).toBe('ok');
    expect(await raw('special_timings').countDocuments({ masjid_id: ALPHA })).toBe(count + 2);
    expect(await version(ALPHA)).toBe(before + 2);
  });

  it('notify: a timing_update item for the date and a pending outbox job', async () => {
    const result = await save(EID, { notify: true });
    const item = await raw('items').findOne({ public_id: result.item?.publicId }, { promoteLongs: false });
    expect(item).toMatchObject({
      type: 'timing_update',
      status: 'published',
      audience: 'everyone',
      template_key: 'special_timings',
      template_params: { date: '2026-11-20' },
      notify: true,
      announcement: { category: 'timing' },
      created_by: ADMIN_ID,
    });
    expect((item?.['published_version'] as Long).toNumber()).toBe(await version(ALPHA));
    expect(await raw('notification_jobs').findOne({ item_id: item?._id })).toMatchObject({
      masjid_id: ALPHA,
      status: 'pending',
    });
  });

  it('no notifications left: NOTIFY_QUOTA_EXCEEDED and nothing is saved', async () => {
    const count = await raw('special_timings').countDocuments({ masjid_id: ALPHA });
    await raw('masjids').updateOne({ _id: ALPHA }, { $set: { push_daily_quota: 0 } });
    try {
      expect(await code(save(EID, { notify: true }))).toBe('NOTIFY_QUOTA_EXCEEDED');
      expect(await raw('special_timings').countDocuments({ masjid_id: ALPHA })).toBe(count);
    } finally {
      await raw('masjids').updateOne({ _id: ALPHA }, { $set: { push_daily_quota: 8 } });
    }
  });

  it("another masjid, another masjid's entry and a deleted entry read as unknown", async () => {
    expect(await code(save(EID, { masjidId: BETA }))).toBe('MASJID_NOT_FOUND');
    const beta = await raw('special_timings').findOne({ masjid_id: BETA });
    expect(beta).not.toBeNull();
    expect(await code(save(EID, { id: beta?._id as UUID }))).toBe('SPECIAL_DATE_NOT_FOUND');
    expect(
      await code(deleteSpecialDate(adm(), adminOf(ALPHA), { masjidId: ALPHA, id: beta?._id as UUID, now: NOW })),
    ).toBe('SPECIAL_DATE_NOT_FOUND');
    expect(await raw('special_timings').findOne({ _id: beta?._id as UUID })).not.toHaveProperty('deleted_at');
  });
});

describe('deleteSpecialDate', () => {
  it('soft-deletes: version bump, audit entry, gone from the admin list and the musalli bundle; a second delete is 404', async () => {
    const { id } = await save(EID);
    const before = await version(ALPHA);
    await deleteSpecialDate(adm(), adminOf(ALPHA), { masjidId: ALPHA, id: idOf(id), now: NOW });
    expect(await raw('special_timings').findOne({ _id: idOf(id) })).toMatchObject({ deleted_at: NOW });
    expect(await version(ALPHA)).toBe(before + 1);
    expect(await raw('audit_log').findOne({ action: 'special.delete', target_id: id })).not.toBeNull();
    expect((await listSpecialDates(adm(), adminOf(ALPHA), ALPHA, TODAY)).some((entry) => entry.id === id)).toBe(false);
    const bundle = await getMasjidBundle(pub(), ALPHA, TODAY);
    expect(bundle?.status === 'active' && bundle.specialDates.some((entry) => entry.id === id)).toBe(false);
    expect(await code(deleteSpecialDate(adm(), adminOf(ALPHA), { masjidId: ALPHA, id: idOf(id), now: NOW }))).toBe(
      'SPECIAL_DATE_NOT_FOUND',
    );
    expect(await code(save(EID, { id: idOf(id) }))).toBe('SPECIAL_DATE_NOT_FOUND');
  });
});

describe('saveRamadan', () => {
  const ramadan = (start: string | null, end: string | null, sehri = 5, iftar = 3) =>
    saveRamadan(adm(), adminOf(ALPHA), {
      masjidId: ALPHA,
      ramadan: { start, end, sehriPrecautionMin: sehri, iftarPrecautionMin: iftar },
      now: NOW,
    });

  it('turns Ramadan mode on: stored, version bump, audit entry, in the admin read and the musalli bundle', async () => {
    const before = await version(ALPHA);
    await ramadan('2027-02-08', '2027-03-09');
    expect(await raw('masjids').findOne({ _id: ALPHA })).toMatchObject({
      ramadan_start: '2027-02-08',
      ramadan_end: '2027-03-09',
      sehri_precaution_min: 5,
      iftar_precaution_min: 3,
    });
    expect(await version(ALPHA)).toBe(before + 1);
    expect(await raw('audit_log').findOne({ action: 'ramadan.update', masjid_id: ALPHA })).toMatchObject({
      meta: { on: true },
    });
    expect(await getRamadan(adm(), adminOf(ALPHA), ALPHA)).toEqual({
      start: '2027-02-08',
      end: '2027-03-09',
      sehriPrecaution: 5,
      iftarPrecaution: 3,
    });
    const bundle = await getMasjidBundle(pub(), ALPHA, TODAY);
    expect(bundle?.status === 'active' && bundle.ramadan).toEqual({
      start: '2027-02-08',
      end: '2027-03-09',
      sehriPrecautionMin: 5,
      iftarPrecautionMin: 3,
    });
  });

  it('turns it off: dates removed, precautions kept', async () => {
    await ramadan(null, null, 2, 1);
    const stored = await raw('masjids').findOne({ _id: ALPHA });
    expect(stored).not.toHaveProperty('ramadan_start');
    expect(stored).not.toHaveProperty('ramadan_end');
    expect(await getRamadan(adm(), adminOf(ALPHA), ALPHA)).toEqual({
      start: null,
      end: null,
      sehriPrecaution: 2,
      iftarPrecaution: 1,
    });
    const bundle = await getMasjidBundle(pub(), ALPHA, TODAY);
    expect(bundle?.status === 'active' && bundle.ramadan).toBeNull();
  });

  it('refuses an end before the start, more than 30 days, a date out of the window and half a range', async () => {
    const before = await version(ALPHA);
    for (const [start, end] of [
      ['2027-03-09', '2027-02-08'],
      ['2027-02-08', '2027-03-10'], // 31 days
      ['2027-12-09', '2027-12-20'],
      ['2027-02-08', null],
      [null, '2027-03-09'],
    ] as const) {
      expect(await code(ramadan(start, end))).toBe('RAMADAN_INVALID');
    }
    expect(await version(ALPHA)).toBe(before);
  });

  it('another masjid reads as unknown', async () => {
    expect(
      await code(
        saveRamadan(adm(), adminOf(ALPHA), {
          masjidId: BETA,
          ramadan: { start: null, end: null, sehriPrecautionMin: 0, iftarPrecautionMin: 0 },
          now: NOW,
        }),
      ),
    ).toBe('MASJID_NOT_FOUND');
    expect(await code(getRamadan(adm(), adminOf(ALPHA), BETA))).toBe('MASJID_NOT_FOUND');
    await expect(listSpecialDates(adm(), adminOf(ALPHA), BETA, TODAY)).rejects.toThrow(StateError);
  });
});
