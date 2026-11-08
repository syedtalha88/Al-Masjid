// PHASE_04 T4.8 — fan-out load test: 50,000 devices follow one masjid; one notifying publish goes through the real
// worker runtime (BullMQ on the local Redis, MongoDB as `mc_system`, web-push encryption + VAPID for every send)
// against a mock push receiver answering in 50–300 ms with 0.5 % 410 Gone. Measures the total dispatch time, per-batch
// durations, the worker's CPU and memory, Redis memory and MongoDB operations.
//
// Run: `pnpm load:push` (needs `pnpm db:start` and `.env.local.test`; uses its own database and Redis prefix, removed
// afterwards). Results: stdout and docs/reports/evidence/PHASE_04_T4.8_push-load.md.
import { createECDH, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';

import { createLogger, createPushSender, redisSendLedger } from '@mc/api';
import { startJobWorkers } from '@mc/api/jobs/worker';
import { createMockPushService, createTestRedis } from '@mc/api/testing';
import { idText, newId, systemScope, toInt64 } from '@mc/db';
import { runMigrations } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';
import { buildDevSeed, seedId, writeDevSeed } from '@mc/db/seed';
import { createTestDatabase, processUserHandle } from '@mc/db/testing';
import { Redis } from 'ioredis';
import webpush from 'web-push';

const root = fileURLToPath(new URL('../..', import.meta.url));
process.loadEnvFile(`${root}.env.local.test`);

const DEVICES = Number(process.env['LOAD_DEVICES'] ?? 50_000);
const GONE_SHARE = 0.005;
const LIMIT_MS = 3 * 60_000;
const WORKER_CPU = 0.75; // infra/compose/docker-compose.vps.yml worker limits
const WORKER_MEMORY_MB = 512;
const NOW = new Date();

const ms = (n: number) => `${(n / 1000).toFixed(1)} s`;
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;
const percentile = (sorted: readonly number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;

const db = await createTestDatabase('push_load');
await runMigrations(db.db, MIGRATIONS);
const system = await processUserHandle(db, 'mc_system');
await writeDevSeed(system.handle, systemScope(), buildDevSeed({ now: NOW, today: NOW.toISOString().slice(0, 10) }));
const masjidId = seedId('masjid-alpha');
const testRedis = await createTestRedis('push-load');
const bull = new Redis(process.env['REDIS_URL_TEST'] ?? '', { maxRetriesPerRequest: null });

// --- seed -----------------------------------------------------------------------------------------------------------
const browser = createECDH('prime256v1');
browser.generateKeys();
const keys = {
  push_p256dh: browser.getPublicKey().toString('base64url'),
  push_auth: randomBytes(16).toString('base64url'),
};
const LOCALES = ['en', 'en', 'en', 'hi', 'hi', 'ur', 'te'] as const;
/** Raw collections for seeding (the load test writes fixtures the way the data layer stores them). */
const raw = (name: string) => db.db.collection<{ _id: unknown } & Record<string, unknown>>(name);
const seedStarted = performance.now();
for (let start = 0; start < DEVICES; start += 5000) {
  const devices = [];
  const follows = [];
  for (let n = start; n < Math.min(DEVICES, start + 5000); n += 1) {
    const id = newId();
    const locale = LOCALES[n % LOCALES.length] ?? 'en';
    const pref = n % 2 === 0 ? 'brothers' : 'sisters';
    devices.push({
      _id: id,
      secret_hash: Buffer.alloc(32, 1),
      locale,
      audience_pref: pref,
      platform: 'android',
      push_status: 'active',
      push_endpoint: `https://fcm.googleapis.com/fcm/send/load-${idText(id)}`,
      ...keys,
      privacy_version: 'draft-1',
      follow_count: 1,
      created_at: NOW,
      last_seen_at: NOW,
    });
    follows.push({
      _id: newId(),
      device_id: id,
      masjid_id: masjidId,
      muted: false,
      audience_pref: pref,
      locale,
      push_active: true,
      created_at: NOW,
    });
  }
  await raw('devices').insertMany(devices);
  await raw('device_follows').insertMany(follows);
}
const seedMs = performance.now() - seedStarted;

const itemId = newId();
const publicId = randomBytes(9).toString('base64url');
await raw('items').insertOne({
  _id: itemId,
  public_id: publicId,
  masjid_id: masjidId,
  type: 'announcement',
  status: 'published',
  audience: 'everyone',
  title: 'Test load notice',
  body: 'Test load body.',
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
  audience: 'everyone',
  audience_targets: ['brothers', 'sisters'],
  targeted: 0,
  sent: 0,
  failed: 0,
  pruned: 0,
  pending_batches: 0,
  bypass_quota: false,
  created_at: NOW,
});

// --- the receiver: 50–300 ms, 0.5 % gone ----------------------------------------------------------------------------
const receiver = createMockPushService();
receiver.latency(() => 50 + Math.floor(Math.random() * 250));
receiver.answerAll(() => (Math.random() < GONE_SHARE ? 410 : 201));

const prefix = `${testRedis.prefix}bull`;
const workers = await startJobWorkers({
  db: system.handle,
  connection: bull,
  ledger: redisSendLedger(testRedis.redis),
  sender: createPushSender({
    vapid: { subject: 'mailto:load@example.test', ...webpush.generateVAPIDKeys() },
    transport: receiver.transport,
  }),
  logger: createLogger({ process: 'worker', level: 'warn', release: 'load' }),
  prefix,
  schedulers: false,
});
await workers.ready();

// --- run --------------------------------------------------------------------------------------------------------------
const serverStatus = async () =>
  (await db.db
    .admin()
    .command({ serverStatus: 1 })
    .catch(() => null)) as { opcounters?: Record<string, number> } | null;
const before = await serverStatus();
const cpuBefore = process.cpuUsage();
let peakRss = 0;
const sampler = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 200);
const started = performance.now();
await workers.queues.enqueue('push-fanout', { jobId: idText(jobId) }, { jobId: idText(jobId) });
const finished = async (): Promise<Record<string, unknown>> => {
  for (;;) {
    const doc = await db.db.collection('notification_jobs').findOne({ _id: jobId as never }); // a UUID id (driver typing)
    if (doc && (doc['status'] === 'completed' || doc['status'] === 'failed')) return doc;
    if (performance.now() - started > 10 * 60_000) throw new Error('load test: no completion within 10 minutes');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};
const job = await finished();
const totalMs = performance.now() - started;
clearInterval(sampler);
const cpu = process.cpuUsage(cpuBefore);
const after = await serverStatus();

const batches = await workers.queues.queue('push-send-batch').getJobs(['completed']);
const durations = batches
  .map((entry) => (entry.finishedOn ?? 0) - (entry.processedOn ?? 0))
  .filter((value) => value > 0)
  .sort((a, b) => a - b);
const fanouts = await workers.queues.queue('push-fanout').getJobs(['completed']);
const fanoutMs = fanouts[0] ? (fanouts[0].finishedOn ?? 0) - (fanouts[0].processedOn ?? 0) : 0;
const redisInfo = await bull.info('memory').catch(() => '');
const redisPeak = /used_memory_peak_human:(\S+)/.exec(redisInfo)?.[1] ?? 'n/a';
const ops = (key: string) =>
  before?.opcounters && after?.opcounters
    ? String((after.opcounters[key] ?? 0) - (before.opcounters[key] ?? 0))
    : 'n/a';
const cpuSeconds = (cpu.user + cpu.system) / 1e6;
const cpuBudget = (WORKER_CPU * Math.max(totalMs, 1)) / 1000;

const rows: [string, string, string][] = [
  ['Devices following the masjid', String(DEVICES), ''],
  ['Job status', String(job['status']), job['status'] === 'completed' ? 'PASS' : 'FAIL'],
  [
    'Targeted / sent / failed / pruned',
    `${String(job['targeted'])} / ${String(job['sent'])} / ${String(job['failed'])} / ${String(job['pruned'])}`,
    '',
  ],
  ['Total dispatch time (enqueue → completed)', ms(totalMs), totalMs < LIMIT_MS ? 'PASS (< 3 min)' : 'FAIL (≥ 3 min)'],
  ['Fan-out job', ms(fanoutMs), ''],
  ['Send batches', String(batches.length), ''],
  [
    'Batch duration p50 / p95 / max',
    `${ms(percentile(durations, 0.5))} / ${ms(percentile(durations, 0.95))} / ${ms(durations.at(-1) ?? 0)}`,
    (durations.at(-1) ?? 0) < 240_000 ? 'PASS (< 240 s timeout)' : 'FAIL',
  ],
  [
    'Worker CPU time (user + system)',
    `${cpuSeconds.toFixed(1)} s`,
    cpuSeconds < cpuBudget
      ? `PASS (< ${cpuBudget.toFixed(0)} s = 0.75 CPU × run time)`
      : `OVER 0.75 CPU (${cpuBudget.toFixed(0)} s)`,
  ],
  [
    'Worker peak RSS',
    mb(peakRss),
    peakRss < WORKER_MEMORY_MB * 1024 * 1024 ? `PASS (< ${String(WORKER_MEMORY_MB)} MB)` : 'FAIL',
  ],
  ['Redis used memory (peak)', redisPeak, ''],
  [
    'MongoDB ops (query / insert / update / command)',
    `${ops('query')} / ${ops('insert')} / ${ops('update')} / ${ops('command')}`,
    '',
  ],
  ['Push requests made', String(receiver.requests.length), ''],
  ['Seeding time (not measured above)', ms(seedMs), ''],
  [
    'Machine',
    `${String(cpus().length)} CPUs, ${mb(totalmem())} RAM, Node ${process.version}`,
    'local Docker MongoDB + Redis',
  ],
];
const table = ['| Measure | Value | Check |', '|---|---|---|', ...rows.map((row) => `| ${row.join(' | ')} |`)].join(
  '\n',
);
const report = `# PHASE_04 T4.8 — push fan-out load test\n\nRun: ${new Date().toISOString()} (\`pnpm load:push\`). Receiver: in-process mock, 50–300 ms per request, ${String(GONE_SHARE * 100)} % 410. Every send is a real aes128gcm encryption + VAPID signature.\n\n${table}\n`;
process.stdout.write(`${report}\n`);
writeFileSync(`${root}docs/reports/evidence/PHASE_04_T4.8_push-load.md`, report);

await workers.queues
  .queue('push-fanout')
  .obliterate({ force: true })
  .catch(() => undefined);
await workers.queues
  .queue('push-send-batch')
  .obliterate({ force: true })
  .catch(() => undefined);
await workers.close();
await bull.quit();
await testRedis.dispose();
await system.dispose();
await db.dispose();
process.exit(job['status'] === 'completed' && totalMs < LIMIT_MS ? 0 : 1);
