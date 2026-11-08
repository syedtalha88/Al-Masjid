// Entrypoint: worker (BullMQ processors + schedulers, 01 §5.8): the push pipeline and alerts (Phase 4 — the only
// process with the VAPID private key), the outbox sweeper schedule, the heartbeat; later phases add their jobs.
import { createLogger, createPushSender, redisSendLedger } from '@mc/api';
import { ensureDevSeed } from '@mc/api/jobs/seed';
import { startJobWorkers } from '@mc/api/jobs/worker';
import { createDbHandle } from '@mc/db';
import { Redis } from 'ioredis';

import { startHeartbeat } from './heartbeat.ts';
import { bootEnv, onShutdownSignal } from './lifecycle.ts';
import { startServerSentry } from './sentry.ts';

const env = bootEnv('worker', process);
const logger = createLogger({ process: 'worker', level: env.LOG_LEVEL, release: env.RELEASE });
const sentry = startServerSentry({
  dsn: env.SENTRY_DSN,
  release: env.RELEASE,
  environment: env.APP_ENV,
  process: 'worker',
});

// BullMQ workers need maxRetriesPerRequest: null (blocking commands). Never use ioredis keyPrefix with BullMQ.
const redis = new Redis(env.REDIS_URL_WORKER, { maxRetriesPerRequest: null, connectionName: 'mc-worker' });
redis.on('error', (error) => {
  logger.error({ err: error }, 'redis connection error');
});

const stopHeartbeat = startHeartbeat(redis, (error) => {
  logger.error({ err: error }, 'heartbeat failed');
  sentry?.report(error);
});
const db = createDbHandle({
  uri: env.MONGODB_URI_SYSTEM,
  database: env.MONGODB_DB_NAME,
  process: 'worker',
  local: env.APP_ENV === 'local',
});
const jobs = await startJobWorkers({
  db,
  connection: redis,
  ledger: redisSendLedger(redis),
  sender: createPushSender({
    vapid: { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
  }),
  logger,
  ...(sentry ? { report: sentry.report } : {}),
});
await jobs.ready();

// Staging only: keep the dev seed present and its relative dates current (PHASE_02 T2.2, DECISIONS #91).
const SEED_CHECK_MS = 6 * 60 * 60 * 1000;
const seedDb = env.APP_ENV === 'staging' ? db : undefined;
const checkSeed = async () => {
  if (!seedDb) return;
  try {
    const result = await ensureDevSeed(seedDb, env.APP_ENV, new Date());
    logger.info({ result }, 'staging seed checked');
  } catch (error) {
    logger.error({ err: error }, 'staging seed failed');
    sentry?.report(error);
  }
};
await checkSeed();
const seedTimer = seedDb
  ? setInterval(() => {
      void checkSeed();
    }, SEED_CHECK_MS)
  : undefined;

logger.info({ appEnv: env.APP_ENV }, 'worker ready');

onShutdownSignal(async (signal) => {
  logger.info({ signal }, 'worker shutting down');
  stopHeartbeat();
  if (seedTimer) clearInterval(seedTimer);
  await jobs.close(); // lets running jobs finish (BullMQ waits for active ones)
  await db.close();
  await redis.quit();
  await sentry?.flush();
  logger.info('worker stopped');
}, process);
