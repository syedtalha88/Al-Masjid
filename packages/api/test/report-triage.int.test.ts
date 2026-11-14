// PHASE_08 T8.1 — the `report-triage` job as mc_system with a controlled clock: an urgent report raises exactly one
// Super Admin alert, also over repeated runs; a normal report raises none; a post reported by `threshold` distinct
// devices within the hour is hidden once (alert once, version bump), fewer devices or reports spread over more than an
// hour hide nothing; a run that hid a post but lost its alert raises it again (same job id → one push).
import { createHash, randomBytes } from 'node:crypto';

import { deviceScope, idText, publicScope } from '@mc/db';
import { runMigrations } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';
import { seedPublicId } from '@mc/db/seed';
import { createReport, registerDevice, type ReportReasonValue } from '@mc/db/state';
import { createTestDatabase, processUserHandle, type TestDatabase } from '@mc/db/testing';
import { ManualClock } from '@mc/shared/clock';
import { reportSla } from '@mc/shared/compliance';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { processReportTriage } from '../src/jobs/reports/triage.ts';
import { runDevSeed } from '../src/jobs/seed.ts';
import type { JobQueues } from '../src/queue/queues.ts';
import { silentLogger } from './helpers.ts';

const START = new Date('2026-11-13T06:30:00Z');
const MINUTE = 60 * 1000;
const clock = new ManualClock(START);
const logger = silentLogger();

let test: TestDatabase | undefined;
let asPublic: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const pub = () => {
  if (!asPublic) throw new Error('no mc_public handle');
  return asPublic.handle;
};
const sys = () => {
  if (!asSystem) throw new Error('no mc_system handle');
  return asSystem.handle;
};

/** Records enqueued jobs like BullMQ (a job id already queued is not added again): alerts by type, others by name. */
let sent: { jobId: string; type: string }[] = [];
let failNext = false;
const queues = {
  enqueue: (name: string, data: { alert?: { type: string } }, options: { jobId: string }) => {
    if (failNext) {
      failNext = false;
      return Promise.reject(new Error('redis down'));
    }
    if (!sent.some((entry) => entry.jobId === options.jobId))
      sent.push({ jobId: options.jobId, type: data.alert?.type ?? name });
    return Promise.resolve();
  },
} as unknown as JobQueues; // only `enqueue` is called
const run = () => processReportTriage({ db: sys(), queues, clock, logger });

const newDevice = async () =>
  registerDevice(pub(), publicScope(), {
    secretHash: createHash('sha256').update(randomBytes(32)).digest(),
    locale: 'en',
    audiencePref: 'brothers',
    platform: 'android',
    privacyVersion: 'draft-1',
    now: clock.now(),
  });
const reportPost = async (publicId: string, reason: ReportReasonValue = 'misleading') => {
  const now = clock.now();
  return createReport(pub(), deviceScope(await newDevice()), {
    target: { kind: 'item', publicId },
    reason,
    ...reportSla(reason, now),
    now,
  });
};
const statusOf = async (publicId: string): Promise<unknown> =>
  (await t().db.collection<{ status?: string }>('items').findOne({ public_id: publicId }))?.status;

beforeAll(async () => {
  test = await createTestDatabase('report-triage');
  await runMigrations(t().db, MIGRATIONS);
  asPublic = await processUserHandle(t(), 'mc_public');
  asSystem = await processUserHandle(t(), 'mc_system');
  await runDevSeed(asSystem.handle, 'local', START);
  await t()
    .db.collection<{ _id: string }>('app_settings')
    .updateOne({ _id: 'global' }, { $set: { report_autohide_threshold: 3 } });
});

afterAll(async () => {
  await asPublic?.dispose();
  await asSystem?.dispose();
  await test?.dispose();
});

beforeEach(async () => {
  sent = [];
  failNext = false;
  // Each test starts with every earlier report already looked at.
  await t()
    .db.collection('reports')
    .updateMany({ triaged_at: { $exists: false } }, { $set: { triaged_at: clock.now() } });
});

describe('report-triage', () => {
  it('nothing new: nothing happens', async () => {
    expect(await run()).toEqual({ triaged: 0, urgent: 0, hidden: 0 });
    expect(sent).toEqual([]);
  });

  it('an urgent report alerts the Super Admin exactly once; a normal one never', async () => {
    const urgent = await reportPost(seedPublicId('alpha', 0), 'private_info');
    await reportPost(seedPublicId('alpha', 0), 'copyright');
    expect(await run()).toEqual({ triaged: 2, urgent: 1, hidden: 0 });
    expect(sent).toEqual([{ jobId: `alert.report_urgent.${idText(urgent)}`, type: 'report_urgent' }]);
    clock.advance(MINUTE);
    expect(await run()).toEqual({ triaged: 0, urgent: 0, hidden: 0 });
    expect(sent).toHaveLength(1);
    expect(await statusOf(seedPublicId('alpha', 0))).toBe('published'); // reports alone never hide
  });

  it('an enqueue failure leaves the report for the next run, which raises the alert once', async () => {
    const urgent = await reportPost(seedPublicId('alpha', 1), 'private_info');
    failNext = true;
    await expect(run()).rejects.toThrow('redis down');
    clock.advance(MINUTE);
    expect(await run()).toMatchObject({ triaged: 1, urgent: 1 });
    expect(sent).toEqual([{ jobId: `alert.report_urgent.${idText(urgent)}`, type: 'report_urgent' }]);
  });

  it('threshold devices within the hour hide the post once, with one alert, a CDN purge and a file check (M4)', async () => {
    const post = seedPublicId('beta', 0);
    await reportPost(post);
    await reportPost(post);
    expect(await run()).toMatchObject({ hidden: 0 });
    expect(await statusOf(post)).toBe('published');
    clock.advance(10 * MINUTE);
    await reportPost(post);
    const hiddenAt = clock.now().getTime();
    expect(await run()).toMatchObject({ triaged: 1, hidden: 1 });
    expect(await statusOf(post)).toBe('hidden');
    const item = await t().db.collection('items').findOne({ public_id: post });
    const itemText = idText(item?._id as never); // the seed post exists
    const hide = `${itemText}.${String(hiddenAt)}`;
    expect(sent).toEqual([
      { jobId: `alert.report_autohide.${hide}`, type: 'report_autohide' },
      { jobId: `cdn.autohide.${hide}`, type: 'cdn-purge' },
      { jobId: `media.autohide.${hide}`, type: 'media-access' },
    ]);
    clock.advance(MINUTE);
    expect(await run()).toEqual({ triaged: 0, urgent: 0, hidden: 0 });
    expect(sent).toHaveLength(3);
    const audits = await t().db.collection('audit_log').countDocuments({ action: 'item.autohide' });
    expect(audits).toBe(1);

    // Restored, then hidden again within the day: a new hide with its own alert, purge and file check (N-L2).
    await t()
      .db.collection('items')
      .updateOne({ public_id: post }, { $set: { status: 'published' }, $unset: { hidden_at: '' } });
    clock.advance(10 * MINUTE);
    await reportPost(post);
    await reportPost(post);
    await reportPost(post);
    const againAt = clock.now().getTime();
    expect(await run()).toMatchObject({ hidden: 1 });
    expect(sent.slice(3).map((entry) => entry.jobId)).toEqual([
      `alert.report_autohide.${itemText}.${String(againAt)}`,
      `cdn.autohide.${itemText}.${String(againAt)}`,
      `media.autohide.${itemText}.${String(againAt)}`,
    ]);
  });

  it('reports spread over more than an hour do not hide the post', async () => {
    const post = seedPublicId('beta', 1);
    await reportPost(post);
    await reportPost(post);
    await run();
    clock.advance(61 * MINUTE);
    await reportPost(post);
    expect(await run()).toMatchObject({ hidden: 0 });
    expect(await statusOf(post)).toBe('published');
    expect(sent).toEqual([]);
  });

  it('a hide whose alert was lost raises the alert on the next run (one push)', async () => {
    const post = seedPublicId('beta', 2);
    await reportPost(post);
    await reportPost(post);
    await reportPost(post);
    // The hide commits, then the alert enqueue fails: the reports stay unmarked.
    const realEnqueue = queues.enqueue.bind(queues);
    let calls = 0;
    (queues as { enqueue: unknown }).enqueue = (...args: Parameters<typeof realEnqueue>) => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('redis down')) : realEnqueue(...args);
    };
    try {
      await expect(run()).rejects.toThrow('redis down');
      expect(await statusOf(post)).toBe('hidden');
      clock.advance(MINUTE);
      expect(await run()).toMatchObject({ triaged: 3, hidden: 0 });
    } finally {
      (queues as { enqueue: unknown }).enqueue = realEnqueue;
    }
    expect(sent.map((entry) => entry.type)).toEqual(['report_autohide', 'cdn-purge', 'media-access']);
  });

  it("needs the worker's database user: mc_public may not read reports", async () => {
    await reportPost(seedPublicId('alpha', 2));
    await expect(processReportTriage({ db: pub(), queues, clock, logger })).rejects.toThrow(/not authorized/u);
  });
});
