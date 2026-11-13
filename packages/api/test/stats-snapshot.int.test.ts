// PHASE_08 T8.10 — the hourly `stats-snapshot` job as mc_system against the dev seed (01 §5.8): the hour's document
// holds the same numbers the collections give (masjids by status, devices, follows, push over 24 h), the 30-day
// deadline tallies (on time / late / still open past due; open and not yet due left out), `masjid_stats.ameens_7d`
// (7 days only), the queues' backlog with the age of the OLDEST waiting job (BullMQ ordering pinned against Redis),
// and Cloudinary's 70 / 90 % alerts exactly once each as usage crosses them. A failing Cloudinary read still writes.
import { newId } from '@mc/db';
import { runMigrations } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';
import { seedId } from '@mc/db/seed';
import type { CloudinaryStats, StatsCounts } from '@mc/db/state';
import { createTestDatabase, processUserHandle, type TestDatabase } from '@mc/db/testing';
import { ManualClock } from '@mc/shared/clock';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runDevSeed } from '../src/jobs/seed.ts';
import { processStatsSnapshot, queueStats } from '../src/jobs/stats/snapshot.ts';
import type { AlertService } from '../src/queue/alerts.ts';
import { createJobQueues, type JobQueues } from '../src/queue/queues.ts';
import { testRedisUrl } from '../src/testing/redis.ts';
import { useTestRedis } from '../src/testing/vitest.ts';
import { silentLogger } from './helpers.ts';

const testRedis = useTestRedis(import.meta.url);
const NOW = new Date('2026-11-13T06:05:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const clock = new ManualClock(NOW);
const ALPHA = seedId('masjid-alpha');

let test: TestDatabase | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let bull: Redis | undefined;
let queues: JobQueues | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const sys = () => {
  if (!asSystem) throw new Error('no mc_system handle');
  return asSystem.handle;
};
const q = () => {
  if (!queues) throw new Error('no queues');
  return queues;
};

const raised: { type: string; key: string }[] = [];
const alerts: AlertService = {
  raise: ({ type, key }) => {
    raised.push({ type, key });
    return Promise.resolve(true);
  },
};
let usage: () => Promise<CloudinaryStats> = () => Promise.resolve({ usedPercent: 10 });
const run = () =>
  processStatsSnapshot({
    db: sys(),
    clock,
    logger: silentLogger(),
    queues: q(),
    alerts,
    cloudinaryUsage: () => usage(),
  });
const snapshot = async (hour: string) => {
  const doc = await t().db.collection<{ _id: string; counts: StatsCounts }>('stats_snapshots').findOne({ _id: hour });
  if (!doc) throw new Error(`no snapshot ${hour}`);
  return doc.counts;
};
const ago = (ms: number) => new Date(NOW.getTime() - ms);

beforeAll(async () => {
  test = await createTestDatabase('stats-snapshot');
  await runMigrations(t().db, MIGRATIONS);
  asSystem = await processUserHandle(t(), 'mc_system');
  await runDevSeed(sys(), 'local', NOW);
  bull = new Redis(testRedisUrl(), { maxRetriesPerRequest: null });
  queues = createJobQueues(bull, `${testRedis().prefix}bull`);

  // Ameens on alpha: two in the last 7 days, one older (not counted).
  const ameen = (createdAt: Date) => ({
    _id: newId(),
    dua_item_id: newId(),
    masjid_id: ALPHA,
    device_id: newId(),
    created_at: createdAt,
  });
  await t()
    .db.collection<{ _id: unknown }>('ameens')
    .insertMany([ameen(ago(HOUR)), ameen(ago(6 * DAY)), ameen(ago(8 * DAY))]);

  // Reports in the window: on time, late, open past due (late), open not yet due (left out); one older than 30 days.
  const report = (createdAt: Date, due: Date, done?: Date) => ({
    _id: newId(),
    target_type: 'item',
    target_id: newId(),
    masjid_id: ALPHA,
    reason: 'other',
    urgent: false,
    status: done ? 'actioned' : 'open',
    sla_due_at: due,
    created_at: createdAt,
    ...(done ? { actioned_at: done, closed_at: done } : {}),
  });
  await t()
    .db.collection<{ _id: unknown }>('reports')
    .insertMany([
      report(ago(3 * DAY), ago(2 * DAY), ago(2.5 * DAY)),
      report(ago(3 * DAY), ago(2 * DAY), ago(DAY)),
      report(ago(3 * DAY), ago(2 * DAY)),
      report(ago(HOUR), new Date(NOW.getTime() + DAY)),
      report(ago(40 * DAY), ago(39 * DAY), ago(30.5 * DAY)),
    ]);

  // Grievances: acknowledged on time and resolved late; resolved directly (no acknowledgement) on time.
  const grievance = (n: number, fields: Record<string, unknown>) => ({
    _id: newId(),
    public_ref: `GR-2026-${String(900_000 + n)}`,
    category: 'other',
    description: 'Test grievance',
    created_at: ago(5 * DAY),
    ack_due_at: ago(4 * DAY),
    resolve_due_at: ago(2 * DAY),
    ...fields,
  });
  await t()
    .db.collection<{ _id: unknown }>('grievances')
    .insertMany([
      grievance(1, { status: 'resolved', acknowledged_at: ago(4.5 * DAY), resolved_at: ago(DAY), resolution: 'x' }),
      grievance(2, { status: 'resolved', resolved_at: ago(4.5 * DAY), resolution: 'x' }),
    ]);
}, 60_000);

afterAll(async () => {
  await queues?.close();
  await bull?.quit();
  await asSystem?.dispose();
  await test?.dispose();
});

describe('stats-snapshot (T8.10)', () => {
  it('the hour’s snapshot matches the collections', async () => {
    const { hour } = await run();
    expect(hour).toBe('2026-11-13T06');
    const counts = await snapshot(hour);
    const db = t().db;
    for (const status of ['pending', 'active', 'suspended', 'deleted'] as const) {
      expect(counts.masjids[status]).toBe(await db.collection('masjids').countDocuments({ status }));
    }
    expect(counts.devices.total).toBe(await db.collection('devices').countDocuments());
    expect(
      counts.devices.locale.en + counts.devices.locale.hi + counts.devices.locale.ur + counts.devices.locale.te,
    ).toBe(counts.devices.total);
    expect(counts.follows).toBe(await db.collection('device_follows').countDocuments());
    const jobs = await db
      .collection<{ sent: number; failed: number }>('notification_jobs')
      .find({ created_at: { $gte: ago(DAY) } })
      .toArray();
    expect(counts.push24h).toEqual({
      jobs: jobs.length,
      sent: jobs.reduce((sum, job) => sum + job.sent, 0),
      failed: jobs.reduce((sum, job) => sum + job.failed, 0),
    });
    expect(counts.cloudinary).toEqual({ usedPercent: 10 });
    expect(counts.queues).toMatchObject({ waiting: 0, lagS: 0 });
    // Nothing that identifies a device or a person is in the snapshot.
    expect(JSON.stringify(counts)).not.toMatch(/device_id|endpoint|secret|p256dh/);
  });

  it('deadlines over 30 days: done in time, done late, open past due; open-not-due and older ones left out', async () => {
    const counts = await snapshot('2026-11-13T06');
    expect(counts.sla.reports).toEqual({ onTime: 1, late: 2 });
    expect(counts.sla.grievanceAck).toEqual({ onTime: 2, late: 0 });
    expect(counts.sla.grievanceResolve).toEqual({ onTime: 1, late: 1 });
  });

  it('Ameens of the last 7 days per masjid (masjid_stats.ameens_7d)', async () => {
    const alpha = await t()
      .db.collection<{ _id: typeof ALPHA; ameens_7d: number }>('masjid_stats')
      .findOne({ _id: ALPHA });
    expect(alpha?.ameens_7d).toBe(2);
    const { ameensChanged } = await run(); // same hour again: replaced, nothing changes
    expect(ameensChanged).toBe(0);
    expect(await t().db.collection('stats_snapshots').countDocuments()).toBe(1);
  });

  it('job lag is the age of the oldest waiting job across the queues', async () => {
    // Nothing processes these queues here, so the jobs wait.
    await q().enqueue('campaign-close', {}, { jobId: 'stats-test-a' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await q().enqueue('campaign-close', {}, { jobId: 'stats-test-b' });
    await q().enqueue('payment-activate', {}, { jobId: 'stats-test-c' });
    const oldest = await q().queue('campaign-close').getJob('stats-test-a');
    if (!oldest) throw new Error('job a missing');
    const now = new Date(oldest.timestamp + 90_500);
    const stats = await queueStats(q(), now);
    expect(stats.waiting).toBe(3);
    expect(stats.lagS).toBe(91); // from job a — not b (newer) or c
    await q().queue('campaign-close').obliterate({ force: true });
    await q().queue('payment-activate').obliterate({ force: true });
  });

  it('Cloudinary: 70 % and 90 % alert once each as usage crosses them, keyed by month', async () => {
    raised.length = 0;
    usage = () => Promise.resolve({ usedPercent: 75, credits: { usage: 18.75, limit: 25 }, plan: 'Plus' });
    clock.set(new Date(NOW.getTime() + HOUR));
    await run();
    expect(raised).toEqual([{ type: 'cloudinary_70', key: '2026-11' }]);
    usage = () => Promise.resolve({ usedPercent: 92 });
    clock.set(new Date(NOW.getTime() + 2 * HOUR));
    await run();
    expect(raised).toEqual([
      { type: 'cloudinary_70', key: '2026-11' },
      { type: 'cloudinary_90', key: '2026-11' },
    ]);
    usage = () => Promise.resolve({ usedPercent: 95 });
    clock.set(new Date(NOW.getTime() + 3 * HOUR));
    await run();
    expect(raised).toHaveLength(2);
  });

  it('a failed Cloudinary read still writes the snapshot, without usage and without alerts', async () => {
    raised.length = 0;
    usage = () => Promise.reject(new Error('cloudinary usage failed with HTTP 500'));
    clock.set(new Date(NOW.getTime() + 4 * HOUR));
    const { hour } = await run();
    const counts = await snapshot(hour);
    expect(counts.cloudinary).toBeUndefined();
    expect(counts.masjids.active).toBeGreaterThan(0);
    expect(raised).toHaveLength(0);
  });
});
