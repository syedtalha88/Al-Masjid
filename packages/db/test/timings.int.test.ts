// PHASE_03 T3.2 — saving prayer timings as the real `mc_admin` user: optimistic concurrency on `rev`, the 00 §4.2 rules,
// the version bump and audit entry, and "Notify followers" (a `timing_update` item + pending outbox job + quota count,
// DECISIONS #9, #115) — all or nothing.
import type { Long, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { quotaUsageId } from '../src/repos/index.ts';
import { adminScope, systemScope } from '../src/scope.ts';
import { buildDevSeed, seedId, writeDevSeed } from '../src/seed/index.ts';
import { type PrayerTimingInput, saveTimings, type TimingsInput } from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { idText, newId } from '../src/values.ts';

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
const ADMIN_ID = newId();
const adminOf = (...masjids: UUID[]) =>
  adminScope({ adminId: ADMIN_ID, masjids: masjids.map((id) => ({ id, role: 'owner' as const })) });

const auto = (jamaatOffsetMin: number): PrayerTimingInput => ({
  adhanMode: 'auto',
  adhanAdjustMin: 0,
  jamaatMode: 'offset',
  jamaatOffsetMin,
});
const TIMINGS: TimingsInput = {
  prayers: {
    fajr: auto(20),
    dhuhr: { adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'fixed', jamaatTime: '13:30' },
    asr: auto(15),
    maghrib: auto(5),
    isha: { adhanMode: 'manual', adhanTime: '19:45', adhanAdjustMin: 0, jamaatMode: 'fixed', jamaatTime: '20:15' },
  },
  jumuah: [
    { seq: 2, jamaatTime: '14:00' },
    { seq: 1, khutbahTime: '13:00', jamaatTime: '13:30' },
  ],
};
const version = async (id: UUID) => {
  const masjid = await raw('masjids').findOne({ _id: id }, { promoteLongs: false });
  return (masjid?.['content_version'] as Long).toNumber(); // int64 by schema
};
const revOf = async (id: UUID) => (await raw('masjid_timings').findOne({ _id: id }))?.['rev'];

beforeAll(async () => {
  test = await createTestDatabase('timings-state');
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

describe('saveTimings', () => {
  it('saves at the edited rev: rev + 1, stored as the database shape, version bump, audit entry', async () => {
    const before = await version(ALPHA);
    const rev = (await revOf(ALPHA)) as number; // seed: 1
    const result = await saveTimings(adm(), adminOf(ALPHA), {
      masjidId: ALPHA,
      timings: TIMINGS,
      expectedRev: rev,
      notify: false,
      now: NOW,
    });
    expect(result).toEqual({ rev: rev + 1, item: null, notificationJobId: null });
    const stored = await raw('masjid_timings').findOne({ _id: ALPHA });
    expect(stored).toMatchObject({
      rev: rev + 1,
      updated_by: ADMIN_ID,
      masjid_visible: true,
      prayers: {
        isha: { adhan_mode: 'manual', adhan_time: '19:45', jamaat_mode: 'fixed', jamaat_time: '20:15' },
        maghrib: { adhan_mode: 'auto', adhan_adjust_min: 0, jamaat_mode: 'offset', jamaat_offset_min: 5 },
      },
      // sorted by seq
      jumuah: [
        { seq: 1, khutbah_time: '13:00', jamaat_time: '13:30' },
        { seq: 2, jamaat_time: '14:00' },
      ],
    });
    expect(stored?.['prayers']).not.toHaveProperty('maghrib.jamaat_time');
    expect(await version(ALPHA)).toBe(before + 1);
    expect(
      await raw('audit_log').findOne({ action: 'timings.update', masjid_id: ALPHA }, { sort: { _id: -1 } }),
    ).toMatchObject({ meta: { rev: rev + 1, notify: false } });
  });

  it('a stale rev (someone saved in between) changes nothing', async () => {
    const rev = (await revOf(ALPHA)) as number;
    const before = await version(ALPHA);
    expect(
      await code(
        saveTimings(adm(), adminOf(ALPHA), {
          masjidId: ALPHA,
          timings: TIMINGS,
          expectedRev: rev - 1,
          notify: true,
          now: NOW,
        }),
      ),
    ).toBe('PRECONDITION_FAILED');
    // "no timings yet" when there are some is stale too
    expect(
      await code(
        saveTimings(adm(), adminOf(ALPHA), { masjidId: ALPHA, timings: TIMINGS, expectedRev: 0, notify: false }),
      ),
    ).toBe('PRECONDITION_FAILED');
    expect(await revOf(ALPHA)).toBe(rev);
    expect(await version(ALPHA)).toBe(before);
  });

  it('two admins saving the same rev: exactly one wins', async () => {
    const rev = (await revOf(ALPHA)) as number;
    const save = () =>
      code(saveTimings(adm(), adminOf(ALPHA), { masjidId: ALPHA, timings: TIMINGS, expectedRev: rev, notify: false }));
    const results = await Promise.all([save(), save()]);
    expect(results.sort()).toEqual(['PRECONDITION_FAILED', 'ok']);
    expect(await revOf(ALPHA)).toBe(rev + 1);
  });

  it('refuses times that break the 00 §4.2 rules (Isha before Maghrib); warnings do not block', async () => {
    const rev = (await revOf(ALPHA)) as number;
    const broken: TimingsInput = {
      ...TIMINGS,
      prayers: { ...TIMINGS.prayers, isha: { ...TIMINGS.prayers.isha, adhanTime: '17:00', jamaatTime: '17:10' } },
    };
    expect(
      await code(
        saveTimings(adm(), adminOf(ALPHA), { masjidId: ALPHA, timings: broken, expectedRev: rev, notify: false }),
      ),
    ).toBe('TIMINGS_INVALID');
    // Fajr jamaat after sunrise is only a warning.
    const late: TimingsInput = {
      ...TIMINGS,
      prayers: {
        ...TIMINGS.prayers,
        fajr: { adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'fixed', jamaatTime: '07:30' },
      },
    };
    expect(
      await code(
        saveTimings(adm(), adminOf(ALPHA), { masjidId: ALPHA, timings: late, expectedRev: rev, notify: false }),
      ),
    ).toBe('ok');
  });

  it('another masjid reads as unknown', async () => {
    expect(
      await code(
        saveTimings(adm(), adminOf(ALPHA), { masjidId: BETA, timings: TIMINGS, expectedRev: 1, notify: false }),
      ),
    ).toBe('MASJID_NOT_FOUND');
  });

  it('the first save creates the document (rev 1)', async () => {
    await raw('masjid_timings').deleteOne({ _id: BETA });
    const result = await saveTimings(adm(), adminOf(BETA), {
      masjidId: BETA,
      timings: TIMINGS,
      expectedRev: 0,
      notify: false,
      now: NOW,
    });
    expect(result.rev).toBe(1);
    expect(await raw('masjid_timings').findOne({ _id: BETA })).toMatchObject({ rev: 1, masjid_visible: true });
  });

  it('notify: a timing_update item, a pending outbox job and one notification counted — in the same transaction', async () => {
    const rev = (await revOf(ALPHA)) as number;
    const day = quotaUsageId(ALPHA, TODAY);
    const usedBefore = ((await raw('push_quota_usage').findOne({ _id: day }))?.['count'] as number | undefined) ?? 0;
    const result = await saveTimings(adm(), adminOf(ALPHA), {
      masjidId: ALPHA,
      timings: TIMINGS,
      expectedRev: rev,
      notify: true,
      now: NOW,
    });
    expect(result.item?.publicId).toMatch(/^[A-Za-z0-9_-]{12}$/);
    const item = await raw('items').findOne({ public_id: result.item?.publicId }, { promoteLongs: false });
    expect(item).toMatchObject({
      type: 'timing_update',
      status: 'published',
      audience: 'everyone',
      template_key: 'timings_updated',
      is_important: false,
      notify: true,
      masjid_visible: true,
      announcement: { category: 'timing' },
      created_by: ADMIN_ID,
    });
    expect((item?.['published_version'] as Long).toNumber()).toBe(await version(ALPHA));
    const job = await raw('notification_jobs').findOne({ item_id: item?._id });
    expect(result.notificationJobId).toBe(idText(job?._id as UUID)); // handed to the worker after commit (T4.4)
    expect(job).toMatchObject({
      masjid_id: ALPHA,
      status: 'pending',
      audience: 'everyone',
      audience_targets: ['brothers', 'sisters'],
      sent: 0,
      bypass_quota: false,
    });
    expect((await raw('push_quota_usage').findOne({ _id: day }))?.['count']).toBe(usedBefore + 1);
  });

  it('no notifications left: NOTIFY_QUOTA_EXCEEDED and nothing is saved', async () => {
    const rev = (await revOf(ALPHA)) as number;
    const before = await version(ALPHA);
    const items = await raw('items').countDocuments({ masjid_id: ALPHA });
    await raw('masjids').updateOne({ _id: ALPHA }, { $set: { push_daily_quota: 1 } });
    try {
      expect(
        await code(
          saveTimings(adm(), adminOf(ALPHA), {
            masjidId: ALPHA,
            timings: TIMINGS,
            expectedRev: rev,
            notify: true,
            now: NOW,
          }),
        ),
      ).toBe('NOTIFY_QUOTA_EXCEEDED');
      expect(await revOf(ALPHA)).toBe(rev);
      expect(await version(ALPHA)).toBe(before);
      expect(await raw('items').countDocuments({ masjid_id: ALPHA })).toBe(items);
      // Saving without notifying still works.
      expect(
        await code(
          saveTimings(adm(), adminOf(ALPHA), { masjidId: ALPHA, timings: TIMINGS, expectedRev: rev, notify: false }),
        ),
      ).toBe('ok');
    } finally {
      await raw('masjids').updateOne({ _id: ALPHA }, { $set: { push_daily_quota: 8 } });
    }
  });
});

describe('outbox policy (DECISIONS #115)', () => {
  it('an admin can only add a pending job of an own masjid, with nothing sent and no quota bypass', async () => {
    const { scoped } = await import('../src/scoped.ts');
    const db = await adm().db();
    const jobs = scoped({ scope: adminOf(ALPHA), db }, 'notification_jobs');
    const job = (fields: Record<string, unknown>) => ({
      _id: newId(),
      item_id: newId(),
      masjid_id: ALPHA,
      status: 'pending',
      audience: 'everyone',
      audience_targets: ['brothers', 'sisters'],
      targeted: 0,
      sent: 0,
      failed: 0,
      pruned: 0,
      pending_batches: 0,
      bypass_quota: false,
      created_at: NOW,
      ...fields,
    });
    for (const bad of [{ status: 'running' }, { sent: 5 }, { bypass_quota: true }, { masjid_id: BETA }]) {
      await expect(jobs.insertOne(job(bad))).rejects.toThrow();
    }
    // updates are not allowed at all
    await expect(jobs.updateOne({ masjid_id: ALPHA }, { $set: { status: 'completed' } })).rejects.toThrow();
    const usage = scoped({ scope: adminOf(ALPHA), db }, 'push_quota_usage');
    await expect(usage.updateOne({ masjid_id: ALPHA }, { $set: { day: '2026-01-01' } })).rejects.toThrow();
  });
});
