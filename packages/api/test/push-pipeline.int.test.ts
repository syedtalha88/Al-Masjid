// PHASE_04 T4.4 / T4.7 / T4.1 — the push pipeline end to end on the Docker MongoDB + Redis with real BullMQ workers
// and a mock push service: who receives a notification (audience × mute × push status), one batch per locale with
// the text in that locale, dead subscriptions pruned, a batch retried after partial success and a duplicated fan-out
// sending nothing twice, a fan-out whose enqueue was lost delivered once by the outbox sweeper, the kill switch (zero
// sends while paused, then the same job continues), and invalid payloads refused at process time.
import { createECDH, randomBytes } from 'node:crypto';

import { type DbHandle, deviceScope, idText, newId, parseId, publicScope, toInt64 } from '@mc/db';
import { runMigrations } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';
import { seedId } from '@mc/db/seed';
import { followMasjid, registerDevice, setDevicePush, setFollowMuted } from '@mc/db/state';
import { createTestDatabase, processUserHandle, type TestDatabase } from '@mc/db/testing';
import { followCodeFromBytes } from '@mc/domain/follow-code';
import { type PushPayload, pushPayloadSchema } from '@mc/shared/contracts/push';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import webpush from 'web-push';

import { PushPausedError } from '../src/jobs/push/fanout.ts';
import { processSendBatch } from '../src/jobs/push/send-batch.ts';
import { processOutboxSweep } from '../src/jobs/push/sweeper.ts';
import { runDevSeed } from '../src/jobs/seed.ts';
import { type RunningJobWorkers, startJobWorkers } from '../src/jobs/worker.ts';
import { redisSendLedger } from '../src/push/ledger.ts';
import { createPushSender } from '../src/push/sender.ts';
import { sendBatchJobId } from '../src/queue/jobs.ts';
import { pushNotifier } from '../src/queue/queues.ts';
import { createMockPushService } from '../src/testing/mock-push.ts';
import { testRedisUrl } from '../src/testing/redis.ts';
import { useTestRedis } from '../src/testing/vitest.ts';
import { silentLogger } from './helpers.ts';

const NOW = new Date('2026-11-08T06:30:00Z');
const ALPHA = seedId('masjid-alpha');
const testRedis = useTestRedis(import.meta.url);
const service = createMockPushService();
const VAPID = { subject: 'mailto:alerts@example.test', ...webpush.generateVAPIDKeys() };
// One real browser key pair for every test device (the payload must encrypt; the mock service never decrypts).
const browser = createECDH('prime256v1');
browser.generateKeys();
const KEYS = { p256dh: browser.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };

let test: TestDatabase | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asPublic: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let bull: Redis | undefined;
let workers: RunningJobWorkers | undefined;
let prefix = '';

const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const sys = (): DbHandle => {
  if (!asSystem) throw new Error('no mc_system handle');
  return asSystem.handle;
};
const pub = (): DbHandle => {
  if (!asPublic) throw new Error('no mc_public handle');
  return asPublic.handle;
};
type Id = ReturnType<typeof newId>;
const idOf = (text: string): Id => {
  const id = parseId(text);
  if (!id) throw new Error(`not an id: ${text}`);
  return id;
};
const running = (): RunningJobWorkers => {
  if (!workers) throw new Error('no workers');
  return workers;
};
const raw = (name: string) => t().db.collection<{ _id: Id | string } & Record<string, unknown>>(name);
const endpointOf = (id: Id) => `https://fcm.googleapis.com/fcm/send/${idText(id)}`;

async function waitFor<T>(probe: () => Promise<T | undefined | null | false>, what: string, ms = 20_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** A masjid of its own per scenario (recipients are counted exactly), cloned from the seed. */
async function masjid(): Promise<Id> {
  const seed = await raw('masjids').findOne({ _id: ALPHA }, { promoteLongs: false }); // keep int64 fields int64
  if (!seed) throw new Error('no seed masjid');
  const id = newId();
  await raw('masjids').insertOne({
    ...seed,
    _id: id,
    follow_code: followCodeFromBytes(randomBytes(5)),
    name: 'Test Masjid Push',
    name_i18n: { ur: 'ٹیسٹ مسجد پش' },
  });
  return id;
}

type Pref = 'brothers' | 'sisters';
/** A device registered, subscribed and following through the real state functions (the follow mirror included). */
async function follower(
  masjidId: Id,
  opts: { pref?: Pref; locale?: 'en' | 'hi' | 'ur' | 'te'; muted?: boolean; push?: boolean } = {},
): Promise<Id> {
  const id = await registerDevice(pub(), publicScope(), {
    secretHash: randomBytes(32),
    locale: opts.locale ?? 'en',
    audiencePref: opts.pref ?? 'brothers',
    platform: 'android',
    privacyVersion: 'draft-1',
    now: NOW,
  });
  const device = deviceScope(id);
  await followMasjid(pub(), device, masjidId);
  if (opts.push ?? true) await setDevicePush(pub(), device, { endpoint: endpointOf(id), ...KEYS }, NOW);
  if (opts.muted) await setFollowMuted(pub(), device, masjidId, true);
  return id;
}

/** A published notice and its pending outbox job (what the publish transaction writes — T3.6). */
async function published(masjidId: Id, audience: 'everyone' | Pref = 'everyone'): Promise<string> {
  const itemId = newId();
  await raw('items').insertOne({
    _id: itemId,
    public_id: randomBytes(9).toString('base64url'),
    masjid_id: masjidId,
    type: 'announcement',
    status: 'published',
    audience,
    title: 'Test notice title',
    body: 'Test notice body.',
    content_locale: 'en',
    is_important: false,
    announcement: { category: 'general' },
    notify: true,
    masjid_visible: true,
    published_at: NOW,
    published_version: toInt64(2),
    created_by: newId(),
    created_at: NOW,
    updated_at: NOW,
  });
  const jobId = newId();
  await raw('notification_jobs').insertOne({
    _id: jobId,
    item_id: itemId,
    masjid_id: masjidId,
    status: 'pending',
    audience,
    audience_targets: audience === 'everyone' ? ['brothers', 'sisters'] : [audience],
    targeted: 0,
    sent: 0,
    failed: 0,
    pruned: 0,
    pending_batches: 0,
    bypass_quota: false,
    created_at: NOW,
  });
  return idText(jobId);
}

const job = (jobId: string) => raw('notification_jobs').findOne({ _id: idOf(jobId) });
const finished = (jobId: string) =>
  waitFor(async () => {
    const doc = await job(jobId);
    return doc && (doc['status'] === 'completed' || doc['status'] === 'failed') ? doc : undefined;
  }, `job ${jobId} to finish`);
const deliveredTo = (ids: readonly Id[]) => ids.map(endpointOf).flatMap((endpoint) => service.delivered(endpoint));
const payloadOf = (entry: { payload: string }): PushPayload => pushPayloadSchema.parse(JSON.parse(entry.payload));
const enqueue = (jobId: string) => pushNotifier(running().queues, silentLogger()).afterCommit(jobId);

beforeAll(async () => {
  test = await createTestDatabase('push-pipeline');
  await runMigrations(t().db, MIGRATIONS);
  asSystem = await processUserHandle(t(), 'mc_system');
  asPublic = await processUserHandle(t(), 'mc_public');
  await runDevSeed(asSystem.handle, 'local', NOW);
  bull = new Redis(testRedisUrl(), { maxRetriesPerRequest: null });
  prefix = `${testRedis().prefix}bull`;
  workers = await startJobWorkers({
    db: sys(),
    connection: bull,
    ledger: redisSendLedger(testRedis().redis),
    sender: createPushSender({ vapid: VAPID, transport: service.transport }),
    logger: silentLogger(),
    prefix,
    schedulers: false,
    pauseRecheckMs: 200,
    jobOptions: {
      'push-fanout': { backoff: { type: 'fixed', delay: 50 } },
      'push-send-batch': { backoff: { type: 'fixed', delay: 50 } },
    },
  });
  await workers.ready();
}, 60_000);

afterAll(async () => {
  await workers?.close();
  await bull?.quit();
  await asSystem?.dispose();
  await asPublic?.dispose();
  await test?.dispose();
});

beforeEach(() => {
  service.reset();
});

describe('push pipeline', () => {
  it('everyone: all notifying followers once; never muted or push-off ones', async () => {
    const id = await masjid();
    const brothers = [await follower(id, { pref: 'brothers' }), await follower(id, { pref: 'brothers' })];
    const sisters = [await follower(id, { pref: 'sisters' })];
    const muted = await follower(id, { muted: true });
    const off = await follower(id, { push: false });
    const jobId = await published(id);
    await enqueue(jobId);
    expect(await finished(jobId)).toMatchObject({ status: 'completed', targeted: 3, sent: 3, failed: 0, pruned: 0 });
    expect(deliveredTo([...brothers, ...sisters])).toHaveLength(3);
    expect(deliveredTo([muted])).toHaveLength(0);
    expect(service.requests.some((entry) => entry.endpoint === endpointOf(off))).toBe(false);
  });

  it('an audience: only followers whose Brother / Sister choice matches', async () => {
    const id = await masjid();
    const brother = await follower(id, { pref: 'brothers' });
    const sister = await follower(id, { pref: 'sisters' });
    const jobId = await published(id, 'sisters');
    await enqueue(jobId);
    expect(await finished(jobId)).toMatchObject({ status: 'completed', targeted: 1, sent: 1 });
    expect(deliveredTo([sister])).toHaveLength(1);
    expect(deliveredTo([brother])).toHaveLength(0);
  });

  it('one batch per locale, each with the text in its language; urgency header, never a Topic', async () => {
    const id = await masjid();
    const english = await follower(id, { locale: 'en' });
    const urdu = await follower(id, { locale: 'ur' });
    const jobId = await published(id);
    await enqueue(jobId);
    expect(await finished(jobId)).toMatchObject({ status: 'completed', sent: 2 });
    const [en] = deliveredTo([english]);
    const [ur] = deliveredTo([urdu]);
    if (!en || !ur) throw new Error('missing deliveries');
    expect(payloadOf(en)).toMatchObject({ t: 'Test Masjid Push', l: 'en' });
    expect(payloadOf(ur)).toMatchObject({ t: 'ٹیسٹ مسجد پش', l: 'ur' });
    expect(en.headers).toMatchObject({ Urgency: 'normal', TTL: '86400' });
    expect(en.headers).not.toHaveProperty('Topic'); // the item id would reveal the masjid to the push service (#142)
    // The job document completes inside the last batch's processor, a moment before BullMQ moves that batch to its
    // completed set — so wait for BullMQ instead of reading the set once.
    const ours = await waitFor(async () => {
      const batches = await running().queues.queue('push-send-batch').getJobs(['completed']);
      const mine = batches
        .map((entry) => entry.data as { jobId: string; locale: string }) // validated send-batch payloads
        .filter((data) => data.jobId === jobId);
      return mine.length >= 2 ? mine : undefined;
    }, `both send batches of ${jobId} to complete`);
    expect(ours.map((data) => data.locale).sort()).toEqual(['en', 'ur']);
  });

  it('404 / 410 prune the subscription (device dead, follows off); 413 counts as failed', async () => {
    const id = await masjid();
    const fine = await follower(id);
    const gone = await follower(id);
    const unknown = await follower(id);
    const tooBig = await follower(id);
    service.answer(endpointOf(gone), 410);
    service.answer(endpointOf(unknown), 404);
    service.answer(endpointOf(tooBig), 413);
    const jobId = await published(id);
    await enqueue(jobId);
    expect(await finished(jobId)).toMatchObject({ status: 'completed', targeted: 4, sent: 1, pruned: 2, failed: 1 });
    expect(deliveredTo([fine])).toHaveLength(1);
    for (const dead of [gone, unknown]) {
      expect(await raw('devices').findOne({ _id: dead })).toMatchObject({ push_status: 'dead' });
      expect(await raw('device_follows').findOne({ device_id: dead })).toMatchObject({ push_active: false });
    }
    expect(await raw('devices').findOne({ _id: tooBig })).toMatchObject({ push_status: 'active' });
  });

  it('a batch retried after partial success sends nothing twice; a duplicated fan-out adds nothing', async () => {
    const id = await masjid();
    const steady = [await follower(id), await follower(id), await follower(id)];
    const flaky = await follower(id);
    const throttled = await follower(id);
    service.answer(endpointOf(flaky), 503, 503, 201);
    service.answer(endpointOf(throttled), { status: 429, retryAfter: '1' }, 201);
    const jobId = await published(id);
    await Promise.all([enqueue(jobId), enqueue(jobId), enqueue(jobId)]);
    expect(await finished(jobId)).toMatchObject({ status: 'completed', targeted: 5, sent: 5, failed: 0 });
    for (const device of [...steady, flaky, throttled]) expect(deliveredTo([device])).toHaveLength(1);
    // the steady devices were each requested once although the batch ran three times
    for (const device of steady)
      expect(service.requests.filter((entry) => entry.endpoint === endpointOf(device))).toHaveLength(1);
    expect(service.requests.filter((entry) => entry.endpoint === endpointOf(flaky))).toHaveLength(3);

    // the whole fan-out enqueued again after completion: no new sends
    const before = service.requests.length;
    await running().queues.queue('push-fanout').remove(jobId);
    await enqueue(jobId);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(service.requests.length).toBe(before);
  });

  it('retries that run out count as failed, and the job still completes', async () => {
    const id = await masjid();
    const fine = await follower(id);
    const down = await follower(id);
    service.answer(endpointOf(down), 500);
    const jobId = await published(id);
    await enqueue(jobId);
    expect(await finished(jobId)).toMatchObject({ status: 'completed', targeted: 2, sent: 1, failed: 1 });
    expect(deliveredTo([fine])).toHaveLength(1);
    expect(service.requests.filter((entry) => entry.endpoint === endpointOf(down))).toHaveLength(5); // 5 attempts
  });

  it('outbox: an enqueue lost with the Redis queues is picked up by the sweeper and delivered once', async () => {
    const id = await masjid();
    const devices = [await follower(id), await follower(id)];
    const jobId = await published(id);
    // The API's after-commit enqueue happened… and then Redis lost the queue (flush / restart without persistence).
    await running().queues.queue('push-fanout').pause();
    await enqueue(jobId);
    await running().queues.queue('push-fanout').obliterate({ force: true });
    await running().queues.queue('push-fanout').resume();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await job(jobId))?.['status']).toBe('pending');

    const sweep = () =>
      processOutboxSweep({
        db: sys(),
        queues: running().queues,
        clock: { now: () => new Date(NOW.getTime() + 3 * 60_000) }, // three minutes after the publish
        logger: silentLogger(),
      });
    expect((await sweep()).requeued).toBeGreaterThanOrEqual(1);
    expect(await finished(jobId)).toMatchObject({ status: 'completed', sent: 2 });
    await sweep(); // a second sweep finds nothing pending for this job
    for (const device of devices) expect(deliveredTo([device])).toHaveLength(1);
  });

  it('sweeper: a finished BullMQ job under a pending id is replaced, a waiting one left alone, a stuck one failed + alerted', async () => {
    const sweep = (minutes: number) =>
      processOutboxSweep({
        db: sys(),
        queues: running().queues,
        clock: { now: () => new Date(NOW.getTime() + minutes * 60_000) },
        logger: silentLogger(),
      });
    const fanout = running().queues.queue('push-fanout');

    // A fan-out that found its outbox job already finished completes in BullMQ; the outbox job is pending again later
    // (e.g. restored) — the sweeper must remove the finished BullMQ job, or the re-add would be swallowed by its id.
    const id = await masjid();
    const device = await follower(id);
    const finishedId = await published(id);
    await raw('notification_jobs').updateOne({ _id: idOf(finishedId) }, { $set: { status: 'completed' } });
    await enqueue(finishedId);
    await waitFor(async () => (await (await fanout.getJob(finishedId))?.getState()) === 'completed', 'fan-out done');
    await raw('notification_jobs').updateOne({ _id: idOf(finishedId) }, { $set: { status: 'pending' } });

    // A job already waiting in the queue is on its way: the sweeper leaves it.
    const waitingId = await published(id);
    await fanout.pause();
    await enqueue(waitingId);
    await sweep(3);
    expect(await (await fanout.getJob(waitingId))?.getState()).toBe('waiting');
    await fanout.resume();
    expect(await finished(finishedId)).toMatchObject({ status: 'completed', sent: 1 });
    expect(await finished(waitingId)).toMatchObject({ status: 'completed', sent: 1 });
    expect(deliveredTo([device])).toHaveLength(2);

    // Running without progress for 10 minutes: failed, and the Super Admin gets a push_job_stuck alert.
    const stuckId = await published(id);
    await raw('notification_jobs').updateOne(
      { _id: idOf(stuckId) },
      { $set: { status: 'running', started_at: NOW, last_progress_at: NOW, fanout_page: 0 } },
    );
    // …unless a batch of the page being fanned out (page = fanout_page, not yet recorded) still waits: the fan-out
    // enqueues a page's batches before it records the page (#144, re-review L-R1).
    const batches = running().queues.queue('push-send-batch');
    await batches.pause();
    const batch = await batches.add('send', {}, { jobId: sendBatchJobId(stuckId, 0, 'te') });
    try {
      await sweep(20);
      expect(await job(stuckId)).toMatchObject({ status: 'running' });
    } finally {
      await batch.remove();
      await batches.resume();
    }
    expect((await sweep(40)).failedStuck).toBeGreaterThanOrEqual(1);
    expect(await job(stuckId)).toMatchObject({ status: 'failed' });
    expect(await running().queues.queue('alert-send').getJob(`alert.push_job_stuck.${stuckId}`)).toBeDefined();
  });

  it('a pause longer than the stuck window loses nothing: no stuck failure, no alert; the job finishes on resume', async () => {
    const id = await masjid();
    const device = await follower(id);
    const jobId = await published(id);
    // A fan-out that was running when the Super Admin paused (its BullMQ job now waits for the switch).
    await raw('notification_jobs').updateOne(
      { _id: idOf(jobId) },
      { $set: { status: 'running', started_at: NOW, last_progress_at: NOW, fanout_page: 0 } },
    );
    await raw('app_settings').updateOne({ _id: 'global' }, { $set: { push_paused: true } });
    try {
      await enqueue(jobId);
      const sweep = (minutes: number) =>
        processOutboxSweep({
          db: sys(),
          queues: running().queues,
          clock: { now: () => new Date(NOW.getTime() + minutes * 60_000) },
          logger: silentLogger(),
        });
      expect((await sweep(20)).failedStuck).toBe(0); // paused: the detector does not run
      expect(await job(jobId)).toMatchObject({ status: 'running' });
      // Resumed, the fan-out still waits in the queue: noted as on its way, not failed.
      await raw('app_settings').updateOne({ _id: 'global' }, { $set: { push_paused: false } });
      expect((await sweep(40)).failedStuck).toBe(0);
      expect(await finished(jobId)).toMatchObject({ status: 'completed', sent: 1 });
      expect(deliveredTo([device])).toHaveLength(1);
      expect(await running().queues.queue('alert-send').getJob(`alert.push_job_stuck.${jobId}`)).toBeUndefined();
    } finally {
      await raw('app_settings').updateOne({ _id: 'global' }, { $set: { push_paused: false } });
    }
  });

  it('brothers only reach Brother phones; a phone pruned as gone is not targeted by the next notification', async () => {
    const id = await masjid();
    const brother = await follower(id, { pref: 'brothers' });
    const gone = await follower(id, { pref: 'brothers' });
    const sister = await follower(id, { pref: 'sisters' });
    service.answer(endpointOf(gone), 410);
    const first = await published(id, 'brothers');
    await enqueue(first);
    expect(await finished(first)).toMatchObject({ status: 'completed', targeted: 2, sent: 1, pruned: 1 });
    expect(deliveredTo([sister])).toHaveLength(0);

    const second = await published(id, 'brothers');
    await enqueue(second);
    expect(await finished(second)).toMatchObject({ status: 'completed', targeted: 1, sent: 1, pruned: 0 });
    expect(deliveredTo([brother])).toHaveLength(2);
    expect(service.requests.filter((entry) => entry.endpoint === endpointOf(gone))).toHaveLength(1); // never again
  });

  it('the outbox sweeper is scheduled every minute in India time (01 §5.8)', async () => {
    const scheduled = await startJobWorkers({
      db: sys(),
      connection: bull ?? new Redis(testRedisUrl(), { maxRetriesPerRequest: null }),
      ledger: redisSendLedger(testRedis().redis),
      sender: createPushSender({ vapid: VAPID, transport: service.transport }),
      logger: silentLogger(),
      prefix: `${prefix}-schedulers`,
      schedulers: true,
      concurrency: { 'push-fanout': 1, 'push-send-batch': 1, 'alert-send': 1, 'outbox-sweeper': 1 },
    });
    try {
      const schedulers = await scheduled.queues.queue('outbox-sweeper').getJobSchedulers();
      expect(schedulers).toEqual([expect.objectContaining({ pattern: '* * * * *', tz: 'Asia/Kolkata' })]);
      // Phase 05: the UPI change-lock every 10 minutes, drives closed at 00:10 IST, retention at 03:00 IST (01 §5.8).
      for (const [job, pattern] of [
        ['payment-activate', '*/10 * * * *'],
        ['campaign-close', '10 0 * * *'],
        ['retention', '0 3 * * *'],
      ] as const) {
        expect(await scheduled.queues.queue(job).getJobSchedulers(), job).toEqual([
          expect.objectContaining({ pattern, tz: 'Asia/Kolkata' }),
        ]);
      }
    } finally {
      await scheduled.close();
    }
  });

  it('ledger: nothing to look up or record for no devices; a batch is claimed once, and again after a release', async () => {
    const ledger = redisSendLedger(testRedis().redis, 'push-ledger-test:');
    const jobKey = idText(newId());
    expect(await ledger.sentAlready(jobKey, [])).toEqual(new Set());
    await ledger.markSent(jobKey, []);
    await ledger.markSent(jobKey, ['a', 'b']);
    expect(await ledger.sentAlready(jobKey, ['a', 'c'])).toEqual(new Set(['a']));
    expect(await ledger.claimBatch(jobKey, `${jobKey}.0.en`)).toBe(true);
    expect(await ledger.claimBatch(jobKey, `${jobKey}.0.en`)).toBe(false);
    await ledger.releaseBatch(jobKey, `${jobKey}.0.en`);
    expect(await ledger.claimBatch(jobKey, `${jobKey}.0.en`)).toBe(true);
  });

  it('kill switch: nothing is sent while paused; on resume the same job continues', async () => {
    const id = await masjid();
    const devices = [await follower(id), await follower(id)];
    await raw('app_settings').updateOne({ _id: 'global' }, { $set: { push_paused: true } });
    const jobId = await published(id);
    try {
      await enqueue(jobId);
      await new Promise((resolve) => setTimeout(resolve, 800));
      expect(service.requests).toHaveLength(0);
      expect((await job(jobId))?.['status']).toBe('pending');
      const state = await (await running().queues.queue('push-fanout').getJob(jobId))?.getState();
      expect(['delayed', 'active', 'waiting']).toContain(state); // re-checking the switch every 200 ms — never failed
    } finally {
      await raw('app_settings').updateOne({ _id: 'global' }, { $set: { push_paused: false } });
    }
    expect(await finished(jobId)).toMatchObject({ status: 'completed', sent: 2 });
    for (const device of devices) expect(deliveredTo([device])).toHaveLength(1);
  });

  it('an item deleted before the fan-out notifies nobody', async () => {
    const id = await masjid();
    await follower(id);
    const jobId = await published(id);
    const doc = await job(jobId);
    await raw('items').updateOne({ _id: doc?.['item_id'] as Id }, { $set: { status: 'deleted' } });
    await enqueue(jobId);
    expect(await finished(jobId)).toMatchObject({ status: 'failed', last_error: 'item no longer published' });
    expect(service.requests).toHaveLength(0);
  });

  it('a payload that does not validate fails at process time without retries', async () => {
    const queue = running().queues.queue('push-send-batch');
    // Added past the producer's validation, as a forged job in Redis would be.
    const forged = await queue.add('push-send-batch', { jobId: 'nope', page: -1, locale: 'xx', deviceIds: [] });
    const state = await waitFor(async () => {
      const current = await forged.getState();
      return current === 'failed' ? current : undefined;
    }, 'the forged job to fail');
    expect(state).toBe('failed');
    const failed = await queue.getJob(forged.id ?? '');
    expect(failed?.attemptsMade).toBe(1);
    expect(failed?.failedReason).toBe('invalid push-send-batch job payload');
    expect(service.requests).toHaveLength(0);
  });

  it('F64: a pause during a big batch stops it within one round; on resume only the rest are sent', async () => {
    const id = await masjid();
    const devices = [await follower(id), await follower(id), await follower(id)];
    const jobId = await published(id);
    await raw('notification_jobs').updateOne(
      { _id: idOf(jobId) },
      { $set: { status: 'running', pending_batches: 1, fanout_page: 1, fanout_done: true } },
    );
    const real = createPushSender({ vapid: VAPID, transport: service.transport });
    let sends = 0;
    const deps = {
      db: sys(),
      ledger: redisSendLedger(testRedis().redis),
      // The Super Admin pauses right after the first send.
      sender: {
        send: async (...args: Parameters<typeof real.send>) => {
          const outcome = await real.send(...args);
          sends += 1;
          if (sends === 1) await raw('app_settings').updateOne({ _id: 'global' }, { $set: { push_paused: true } });
          return outcome;
        },
      },
      clock: { now: () => NOW },
      logger: silentLogger(),
      pauseCheckEvery: 1,
    };
    const payload = { jobId, page: 0, locale: 'en' as const, deviceIds: devices.map((device) => idText(device)) };
    try {
      await expect(processSendBatch(deps, payload, { final: false })).rejects.toThrow(PushPausedError);
      expect(deliveredTo(devices)).toHaveLength(1);
    } finally {
      await raw('app_settings').updateOne({ _id: 'global' }, { $set: { push_paused: false } });
    }
    expect(await processSendBatch(deps, payload, { final: false })).toMatchObject({ sent: 3, counted: true });
    for (const device of devices) expect(deliveredTo([device])).toHaveLength(1);
  });

  it('a post taken down during a big batch: nobody else gets it, the batch is counted off (re-review N-L6)', async () => {
    const id = await masjid();
    const devices = [await follower(id), await follower(id), await follower(id)];
    const jobId = await published(id);
    await raw('notification_jobs').updateOne(
      { _id: idOf(jobId) },
      { $set: { status: 'running', pending_batches: 1, fanout_page: 1, fanout_done: true } },
    );
    const itemId = (await raw('notification_jobs').findOne({ _id: idOf(jobId) }))?.['item_id'] as Id; // the job's post
    const real = createPushSender({ vapid: VAPID, transport: service.transport });
    let sends = 0;
    const deps = {
      db: sys(),
      ledger: redisSendLedger(testRedis().redis),
      // Moderation removes the post right after the first send.
      sender: {
        send: async (...args: Parameters<typeof real.send>) => {
          const outcome = await real.send(...args);
          sends += 1;
          if (sends === 1) await raw('items').updateOne({ _id: itemId }, { $set: { status: 'removed' } });
          return outcome;
        },
      },
      clock: { now: () => NOW },
      logger: silentLogger(),
      pauseCheckEvery: 1,
    };
    const payload = { jobId, page: 0, locale: 'en' as const, deviceIds: devices.map((device) => idText(device)) };
    expect(await processSendBatch(deps, payload, { final: false })).toMatchObject({ sent: 1, counted: true });
    expect(deliveredTo(devices)).toHaveLength(1);
    expect(await job(jobId)).toMatchObject({ pending_batches: 0 });
  });

  it('a batch whose counter write fails is counted by its retry — the ledger claim is released (DECISIONS #140)', async () => {
    const id = await masjid();
    const device = await follower(id);
    const jobId = await published(id);
    // A running job whose counters cannot take another send (at the validator's maximum): the write fails.
    await raw('notification_jobs').updateOne(
      { _id: idOf(jobId) },
      { $set: { status: 'running', sent: 2_000_000_000, pending_batches: 1, fanout_page: 1, fanout_done: true } },
    );
    const deps = {
      db: sys(),
      ledger: redisSendLedger(testRedis().redis),
      sender: createPushSender({ vapid: VAPID, transport: service.transport }),
      clock: { now: () => NOW },
      logger: silentLogger(),
    };
    const payload = { jobId, page: 0, locale: 'en' as const, deviceIds: [idText(device)] };
    await expect(processSendBatch(deps, payload, { final: false })).rejects.toThrow(/validation/i);
    expect(deliveredTo([device])).toHaveLength(1); // sent once, and recorded in the sent-set

    await raw('notification_jobs').updateOne({ _id: idOf(jobId) }, { $set: { sent: 0 } });
    expect(await processSendBatch(deps, payload, { final: false })).toMatchObject({ sent: 1, counted: true });
    expect(deliveredTo([device])).toHaveLength(1); // the retry did not send again
    expect(await job(jobId)).toMatchObject({ status: 'completed', sent: 1, pending_batches: 0 });
  });
});
