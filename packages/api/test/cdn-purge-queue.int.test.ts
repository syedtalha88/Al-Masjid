// Security re-review N-M1 (Phase 08): routine masjid purges (needy list) are merged per masjid per window into one
// delayed, low-priority `cdn-purge` job; takedown purges carry no priority, so BullMQ runs them first; the worker's
// limiter keeps the queue under Cloudflare's tag-purge budget. Against the Docker Redis with real BullMQ queues.
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_LIMITERS } from '../src/jobs/worker.ts';
import { cdnPurgeService, MASJID_PURGE_WINDOW_MS, ROUTINE_PURGE_PRIORITY } from '../src/queue/cdn.ts';
import { createJobQueues, type JobQueues } from '../src/queue/queues.ts';
import { testRedisUrl } from '../src/testing/redis.ts';
import { useTestRedis } from '../src/testing/vitest.ts';
import { silentLogger } from './helpers.ts';

const testRedis = useTestRedis(import.meta.url);
const MASJID = '0b0b0b0b-0000-4000-8000-000000000001';
const OTHER = '0b0b0b0b-0000-4000-8000-000000000002';
/** The start of a merge window (a multiple of the window length). */
const WINDOW_START = new Date(Math.ceil(Date.UTC(2026, 10, 14, 6) / MASJID_PURGE_WINDOW_MS) * MASJID_PURGE_WINDOW_MS);
const at = (ms: number) => new Date(WINDOW_START.getTime() + ms);

let bull: Redis | undefined;
let queues: JobQueues | undefined;
/** The tags of a queued purge (BullMQ job data is untyped; the payload schema allows only this shape). */
const tagsOf = (job: { data: unknown }): readonly string[] => (job.data as { tags: string[] }).tags;
const q = () => {
  if (!queues) throw new Error('no queues');
  return queues;
};

beforeAll(() => {
  bull = new Redis(testRedisUrl(), { maxRetriesPerRequest: null });
  queues = createJobQueues(bull, `${testRedis().prefix}bull`);
});

afterAll(async () => {
  await queues?.close();
  bull?.disconnect();
});

describe('cdn-purge queue (N-M1)', () => {
  it('merges routine purges per masjid per window into one delayed, low-priority job', async () => {
    const cdn = cdnPurgeService(q(), silentLogger());
    expect(await cdn.purgeMasjidSoon(MASJID, at(1_000))).toBe(true);
    expect(await cdn.purgeMasjidSoon(MASJID, at(4_000))).toBe(true);
    expect(await cdn.purgeMasjidSoon(MASJID, at(9_999))).toBe(true);
    expect(await cdn.purgeMasjidSoon(OTHER, at(2_000))).toBe(true);
    expect(await cdn.purgeMasjidSoon(MASJID, at(MASJID_PURGE_WINDOW_MS + 1))).toBe(true);
    const delayed = await q().queue('cdn-purge').getDelayed();
    const mine = delayed.filter((job) => tagsOf(job).includes(`m-${MASJID}`));
    expect(mine).toHaveLength(2); // one per window
    // The first change of the window schedules the purge for the window's end — after every change made in it.
    const first = mine.find((job) => job.opts.delay === MASJID_PURGE_WINDOW_MS - 1_000);
    expect(first).toBeDefined();
    expect(first?.opts.priority).toBe(ROUTINE_PURGE_PRIORITY);
    expect(first?.data).toEqual({ tags: [`m-${MASJID}`] });
    expect(delayed.filter((job) => tagsOf(job).includes(`m-${OTHER}`))).toHaveLength(1);
  });

  it('takedown purges carry no priority, so they run before every routine purge', async () => {
    const cdn = cdnPurgeService(q(), silentLogger());
    expect(await cdn.purgeTags(['i-seedA0000001', `m-${MASJID}`], 'takedown.test')).toBe(true);
    const [job] = await q().queue('cdn-purge').getJobs(['waiting', 'prioritized']);
    expect(job?.opts.priority ?? 0).toBe(0);
    expect(job ? tagsOf(job) : []).toContain('i-seedA0000001');
  });

  it('the worker limits cdn-purge under Cloudflare’s 5 tag purges a minute', () => {
    expect(DEFAULT_LIMITERS['cdn-purge']).toEqual({ max: 4, duration: 60_000 });
  });

  it('without queues (unit tests) nothing is queued; a Redis that keeps failing is tried three times, then false', async () => {
    const none = cdnPurgeService(null, silentLogger());
    expect(await none.purgeTags(['i-x'], 'k')).toBe(false);
    expect(await none.purgeMasjidSoon(MASJID, at(0))).toBe(false);
    expect(await none.mediaAccess(MASJID, 'k')).toBe(false);
    expect(await none.retentionDryRun?.('k')).toBe(false);
    let tries = 0;
    const down: JobQueues = {
      ...q(),
      enqueue: () => {
        tries += 1;
        return Promise.reject(new Error('redis down'));
      },
    };
    const failing = cdnPurgeService(down, silentLogger());
    expect(await failing.purgeMasjidSoon(MASJID, at(0))).toBe(false);
    expect(tries).toBe(3);
    expect(await failing.mediaAccess(MASJID, 'k')).toBe(false);
    expect(await failing.retentionDryRun?.('k')).toBe(false);
    expect(tries).toBe(9);
  });

  it('media checks and retention dry runs are queued under their keys', async () => {
    const cdn = cdnPurgeService(q(), silentLogger());
    expect(await cdn.mediaAccess(MASJID, 'restore.1')).toBe(true);
    expect(await cdn.retentionDryRun?.('29000000')).toBe(true);
    expect(await q().queue('media-access').getJob('media.restore.1')).toBeDefined();
    expect((await q().queue('retention').getJob('retention.dry.29000000'))?.data).toEqual({ dryRun: true });
  });
});
