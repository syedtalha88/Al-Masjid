// Entrypoint: worker (BullMQ processors + schedulers, 01 §5.8). Phase 0: Redis/BullMQ connection and a
// heartbeat only; processors arrive with their features (push in Phase 4, schedules in later phases).
import { createLogger } from '@mc/api';
import { ensureDevSeed } from '@mc/api/jobs/seed';
import { createDbHandle } from '@mc/db';
import { Queue } from 'bullmq';
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

const systemQueue = new Queue('mc-system', { connection: redis, prefix: 'bull' });
await systemQueue.waitUntilReady();

const stopHeartbeat = startHeartbeat(redis, (error) => {
  logger.error({ err: error }, 'heartbeat failed');
  sentry?.report(error);
});
// Staging only: keep the dev seed present and its relative dates current (PHASE_02 T2.2, DECISIONS #91).
const SEED_CHECK_MS = 6 * 60 * 60 * 1000;
const seedDb =
  env.APP_ENV === 'staging'
    ? createDbHandle({ uri: env.MONGODB_URI_SYSTEM, database: env.MONGODB_DB_NAME, process: 'worker', local: false })
    : undefined;
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

logger.info({ appEnv: env.APP_ENV }, 'worker ready (no processors yet)');

onShutdownSignal(async (signal) => {
  logger.info({ signal }, 'worker shutting down');
  stopHeartbeat();
  if (seedTimer) clearInterval(seedTimer);
  await seedDb?.close();
  await systemQueue.close();
  await redis.quit();
  await sentry?.flush();
  logger.info('worker stopped');
}, process);
