// PHASE_03 T3.1 — the admin read repositories (Admin Home header, quota pill, today strip) against the dev seed, as the
// real `mc_admin` database user: own masjid only (another masjid reads like an unknown one), stats of the last 7 days,
// today's push quota in IST, and the raw schedule in the musalli bundle's shape.
import type { UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { getAdminSchedule, getMasjidStats, getPushQuota, quotaUsageId } from '../src/repos/index.ts';
import { adminScope, publicScope, systemScope } from '../src/scope.ts';
import { buildDevSeed, seedId, writeDevSeed } from '../src/seed/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { newId } from '../src/values.ts';

const NOW = new Date('2026-10-22T06:30:00Z'); // 12:00 IST
const TODAY = '2026-10-22';
const ALPHA = seedId('masjid-alpha');
const BETA = seedId('masjid-beta');

let test: TestDatabase | undefined;
let asAdmin: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const adm = (): DbHandle => {
  if (!asAdmin) throw new Error('no mc_admin handle');
  return asAdmin.handle;
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
/** An admin of Alpha only. */
const alphaAdmin = () => adminScope({ adminId: newId(), masjids: [{ id: ALPHA, role: 'owner' }] });

beforeAll(async () => {
  test = await createTestDatabase('admin-repo');
  await runMigrations(t().db, MIGRATIONS);
  asAdmin = await processUserHandle(t(), 'mc_admin');
  asSystem = await processUserHandle(t(), 'mc_system');
  await writeDevSeed(asSystem.handle, systemScope(), buildDevSeed({ now: NOW, today: TODAY }));
});

afterAll(async () => {
  await asAdmin?.dispose();
  await asSystem?.dispose();
  await test?.dispose();
});

describe('admin read repositories (own masjid only)', () => {
  it('a masjid outside the scope — or a non-admin scope — reads as not found', async () => {
    for (const read of [
      getMasjidStats(adm(), alphaAdmin(), BETA, NOW),
      getPushQuota(adm(), alphaAdmin(), BETA, NOW),
      getAdminSchedule(adm(), alphaAdmin(), BETA),
      getMasjidStats(adm(), publicScope(), ALPHA, NOW),
    ]) {
      expect(await code(read)).toBe('MASJID_NOT_FOUND');
    }
  });

  it('stats: followers and Ameens from masjid_stats, published items of the last 7 days', async () => {
    await raw('masjid_stats').updateOne({ _id: ALPHA }, { $set: { followers: 12, ameens_7d: 5 } }, { upsert: true });
    const weekAgo = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
    const expected = await raw('items').countDocuments({
      masjid_id: ALPHA,
      status: 'published',
      published_at: { $gte: weekAgo },
    });
    expect(expected).toBeGreaterThan(0); // the seed spreads items over three weeks
    expect(await getMasjidStats(adm(), alphaAdmin(), ALPHA, NOW)).toEqual({
      followers: 12,
      itemsThisWeek: expected,
      ameenThisWeek: 5,
    });
    // Items older than 7 days do not count.
    const total = await raw('items').countDocuments({ masjid_id: ALPHA, status: 'published' });
    expect(total).toBeGreaterThan(expected);
  });

  it("quota: today's usage in IST against the masjid's daily quota, reset at the next IST midnight", async () => {
    expect(await getPushQuota(adm(), alphaAdmin(), ALPHA, NOW)).toEqual({
      used: 0,
      limit: 8,
      resetsAt: new Date('2026-10-22T18:30:00Z'), // 23 Oct 00:00 IST
    });
    await raw('push_quota_usage').insertOne({
      _id: quotaUsageId(ALPHA, TODAY),
      masjid_id: ALPHA,
      day: TODAY,
      count: 3,
    });
    expect((await getPushQuota(adm(), alphaAdmin(), ALPHA, NOW)).used).toBe(3);
    // Yesterday's usage is another day.
    const lateYesterdayUtc = new Date('2026-10-21T18:29:00Z'); // 21 Oct 23:59 IST
    expect((await getPushQuota(adm(), alphaAdmin(), ALPHA, lateYesterdayUtc)).used).toBe(0);
  });

  it('schedule: location, calculation settings and raw timings (the bundle shape); null timings before any save', async () => {
    const schedule = await getAdminSchedule(adm(), alphaAdmin(), ALPHA);
    expect(schedule.masjid).toMatchObject({ name: 'Test Masjid Alpha', calcMethod: 'karachi', asrMadhab: 'hanafi' });
    expect(schedule.timings?.prayers.dhuhr).toMatchObject({ jamaatMode: 'fixed', jamaatTime: '13:30' });
    expect(schedule.timings?.jumuah.length).toBeGreaterThan(0);

    const saved = await raw('masjid_timings').findOne({ _id: ALPHA });
    await raw('masjid_timings').deleteOne({ _id: ALPHA });
    try {
      expect((await getAdminSchedule(adm(), alphaAdmin(), ALPHA)).timings).toBeNull();
    } finally {
      if (saved) await raw('masjid_timings').insertOne(saved);
    }
  });
});
