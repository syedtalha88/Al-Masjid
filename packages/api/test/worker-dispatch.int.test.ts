// 01 §5.8 — every scheduled / follow-up job is wired into the real worker: one job per queue of Phases 05 and 08 (UPI
// change-lock, drives, report triage, SLA alerts, CDN purge, media access, retention dry run, stats) runs to
// completion through `startJobWorkers` on the Docker MongoDB + Redis; a forged payload fails without running.
import { idText, isId } from '@mc/db';
import { runMigrations } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';
import { seedPublicId } from '@mc/db/seed';
import { createTestDatabase, processUserHandle, type TestDatabase } from '@mc/db/testing';
import type { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runDevSeed } from '../src/jobs/seed.ts';
import { type RunningJobWorkers, startJobWorkers } from '../src/jobs/worker.ts';
import type { CdnPurger } from '../src/media/cdn-purge.ts';
import { redisSendLedger } from '../src/push/ledger.ts';
import type { PushSender } from '../src/push/sender.ts';
import { testRedisUrl } from '../src/testing/redis.ts';
import { useTestRedis } from '../src/testing/vitest.ts';
import { silentLogger } from './helpers.ts';

const testRedis = useTestRedis(import.meta.url);
const NOW = new Date('2026-11-14T06:30:00Z');

let test: TestDatabase | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let bull: Redis | undefined;
let workers: RunningJobWorkers | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const w = () => {
  if (!workers) throw new Error('no workers');
  return workers;
};

const purgedTags: string[][] = [];
const purger: CdnPurger = {
  purge: () => Promise.resolve(),
  purgeTags: (tags) => {
    purgedTags.push([...tags]);
    return Promise.resolve();
  },
};
const sender: PushSender = { send: () => Promise.resolve({ kind: 'sent' }) };

/** The job's final state (polls; BullMQ needs a QueueEvents connection for `waitUntilFinished`). */
async function settled(queue: Queue, id: string): Promise<string> {
  for (let i = 0; i < 200; i += 1) {
    const state = await (await queue.getJob(id))?.getState();
    if (state === 'completed' || state === 'failed') return state;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return 'timeout';
}

beforeAll(async () => {
  test = await createTestDatabase('worker-dispatch');
  await runMigrations(t().db, MIGRATIONS);
  asSystem = await processUserHandle(t(), 'mc_system');
  await runDevSeed(asSystem.handle, 'local', NOW);
  bull = new Redis(testRedisUrl(), { maxRetriesPerRequest: null });
  workers = await startJobWorkers({
    db: asSystem.handle,
    connection: bull,
    ledger: redisSendLedger(testRedis().redis),
    sender,
    logger: silentLogger(),
    clock: { now: () => NOW },
    prefix: `${testRedis().prefix}bull`,
    cdnPurger: purger,
    retention: { media: undefined, purger, mediaOrigin: undefined, privateFiles: undefined },
    cloudinaryUsage: () => Promise.resolve({ usedPercent: 12 }),
    jobOptions: { 'cdn-purge': { attempts: 1 }, 'media-access': { attempts: 1 } },
  });
});

afterAll(async () => {
  await workers?.close();
  bull?.disconnect();
  await asSystem?.dispose();
  await test?.dispose();
});

describe('the worker runs every job of Phases 05 and 08', () => {
  it('each queue’s job completes through the real dispatcher', async () => {
    const item: unknown = (
      await t()
        .db.collection('items')
        .findOne({ public_id: seedPublicId('alpha', 0) })
    )?.['_id'];
    if (!isId(item)) throw new Error('seed post missing');
    const tags: string[] = ['m-test'];
    const jobs = [
      ['cdn-purge', { tags }],
      ['media-access', { itemId: idText(item) }],
      ['sla-alerts', {}],
      ['report-triage', {}],
      ['payment-activate', {}],
      ['campaign-close', {}],
      ['retention', { dryRun: true }],
      ['stats-snapshot', {}],
    ] as const;
    for (const [name, payload] of jobs) {
      await w().queues.enqueue(name, payload, { jobId: `dispatch.${name}` });
    }
    for (const [name] of jobs) {
      expect(await settled(w().queues.queue(name), `dispatch.${name}`), name).toBe('completed');
    }
    expect(purgedTags).toContainEqual(['m-test']);
    expect(await t().db.collection('stats_snapshots').countDocuments()).toBe(1);
    expect(await t().db.collection('audit_log').countDocuments({ action: 'retention.run' })).toBeGreaterThan(0);
  });

  it('a forged payload (written around the producer’s schema check) fails and runs nothing', async () => {
    const queue = w().queues.queue('cdn-purge');
    const before = purgedTags.length;
    await queue.add('cdn-purge', { tags: ['not a tag'] }, { jobId: 'dispatch.forged', attempts: 1 });
    expect(await settled(queue, 'dispatch.forged')).toBe('failed');
    expect(purgedTags).toHaveLength(before);
  });
});
