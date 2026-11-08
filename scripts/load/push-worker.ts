// PHASE_04 T4.8 — the load test's worker, in its own process (forked by push-fanout.ts) so its memory and CPU are
// measured alone, without the seeding. It is the production worker runtime (BullMQ on the local Redis, MongoDB as
// `mc_system`, web-push encryption + VAPID for every send); only the push service is a stand-in that answers in
// 50–300 ms with 0.5 % 410 Gone and keeps a count, not the requests.
//
// Protocol (IPC): child → `ready` (idle RSS); parent → `start` (enqueue the fan-out, start measuring); parent → `stop`
// (child → `result`, then closes and exits). Configuration comes from the environment the parent sets.
import { createLogger, createPushSender, type PushTransport, redisSendLedger } from '@mc/api';
import { startJobWorkers } from '@mc/api/jobs/worker';
import { createDbHandle } from '@mc/db';
import { Redis } from 'ioredis';
import webpush from 'web-push';

export interface WorkerReady {
  readonly type: 'ready';
  readonly idleRss: number;
}
export interface WorkerResult {
  readonly type: 'result';
  readonly peakRss: number;
  readonly peakHeap: number;
  readonly cpuMicros: number;
  readonly requests: number;
  readonly batchMs: readonly number[];
  readonly fanoutMs: number;
}
export type ParentMessage = { readonly type: 'start' } | { readonly type: 'stop' };

const GONE_SHARE = 0.005;
const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`push-worker: ${name} is not set (run through push-fanout.ts)`);
  return value;
};
const send = (message: WorkerReady | WorkerResult) => {
  process.send?.(message);
};

const db = createDbHandle({
  uri: env('LOAD_MONGO_URI'),
  database: env('LOAD_DATABASE'),
  process: 'worker',
  local: true,
});
const keyPrefix = env('LOAD_REDIS_PREFIX');
const ledgerRedis = new Redis(env('REDIS_URL_TEST'), { keyPrefix, maxRetriesPerRequest: 1 });
const bull = new Redis(env('REDIS_URL_TEST'), { maxRetriesPerRequest: null });

let requests = 0;
const transport: PushTransport = async () => {
  await new Promise((resolve) => setTimeout(resolve, 50 + Math.floor(Math.random() * 250)));
  requests += 1;
  return { status: Math.random() < GONE_SHARE ? 410 : 201, retryAfter: null };
};

const workers = await startJobWorkers({
  db,
  connection: bull,
  ledger: redisSendLedger(ledgerRedis),
  sender: createPushSender({
    vapid: { subject: 'mailto:load@example.test', ...webpush.generateVAPIDKeys() },
    transport,
  }),
  logger: createLogger({ process: 'worker', level: 'warn', release: 'load' }),
  prefix: `${keyPrefix}bull`,
  schedulers: false,
});
await workers.ready();
send({ type: 'ready', idleRss: process.memoryUsage().rss });

let cpuBefore = process.cpuUsage();
let peakRss = 0;
let peakHeap = 0;
const sample = () => {
  const usage = process.memoryUsage();
  peakRss = Math.max(peakRss, usage.rss);
  peakHeap = Math.max(peakHeap, usage.heapUsed);
};
let sampler: ReturnType<typeof setInterval> | undefined;

process.on('message', (message: ParentMessage) => {
  void (async () => {
    if (message.type === 'start') {
      cpuBefore = process.cpuUsage();
      sampler = setInterval(sample, 100);
      const jobId = env('LOAD_JOB_ID');
      await workers.queues.enqueue('push-fanout', { jobId }, { jobId });
      return;
    }
    clearInterval(sampler);
    sample();
    const cpu = process.cpuUsage(cpuBefore);
    const batches = await workers.queues.queue('push-send-batch').getJobs(['completed']);
    const fanouts = await workers.queues.queue('push-fanout').getJobs(['completed']);
    const fanout = fanouts[0];
    send({
      type: 'result',
      peakRss,
      peakHeap,
      cpuMicros: cpu.user + cpu.system,
      requests,
      batchMs: batches.map((entry) => (entry.finishedOn ?? 0) - (entry.processedOn ?? 0)),
      fanoutMs: fanout ? (fanout.finishedOn ?? 0) - (fanout.processedOn ?? 0) : 0,
    });
    for (const name of ['push-fanout', 'push-send-batch'] as const) {
      await workers.queues
        .queue(name)
        .obliterate({ force: true })
        .catch(() => undefined);
    }
    await workers.close();
    await Promise.all([bull.quit(), ledgerRedis.quit(), db.close()]);
    process.exit(0);
  })();
});
