// Entrypoint: worker (BullMQ processors + schedulers, 01 §5.8). Phase 0: Redis/BullMQ connection and a
// heartbeat only; processors arrive with their features (push in Phase 4, schedules in later phases).
import { createLogger } from '@mc/api';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { startHeartbeat } from './heartbeat.ts';
import { bootEnv, onShutdownSignal } from './lifecycle.ts';

const env = bootEnv('worker', process);
const logger = createLogger({ process: 'worker', level: env.LOG_LEVEL, release: env.RELEASE });

// BullMQ workers need maxRetriesPerRequest: null (blocking commands). Never use ioredis keyPrefix with BullMQ.
const redis = new Redis(env.REDIS_URL_WORKER, { maxRetriesPerRequest: null, connectionName: 'mc-worker' });
redis.on('error', (error) => {
  logger.error({ err: error }, 'redis connection error');
});

const systemQueue = new Queue('mc-system', { connection: redis, prefix: 'bull' });
await systemQueue.waitUntilReady();

const stopHeartbeat = startHeartbeat(redis, (error) => {
  logger.error({ err: error }, 'heartbeat failed');
});
logger.info({ appEnv: env.APP_ENV }, 'worker ready (no processors yet)');

onShutdownSignal(async (signal) => {
  logger.info({ signal }, 'worker shutting down');
  stopHeartbeat();
  await systemQueue.close();
  await redis.quit();
  logger.info('worker stopped');
}, process);
