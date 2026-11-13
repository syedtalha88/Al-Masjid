// Entrypoint: worker (BullMQ processors + schedulers, 01 §5.8): the push pipeline and alerts (Phase 4 — the only
// process with the VAPID private key), the outbox sweeper schedule, the heartbeat; later phases add their jobs.
import {
  cloudflarePurger,
  cloudinaryMediaStore,
  cloudinaryPrivateStore,
  createLogger,
  createPushSender,
  redisSendLedger,
} from '@mc/api';
import { ensureDevSeed } from '@mc/api/jobs/seed';
import { startJobWorkers } from '@mc/api/jobs/worker';
import { createDbHandle } from '@mc/db';
import { Redis } from 'ioredis';

import { startHeartbeat } from './heartbeat.ts';
import { bootEnv, onShutdownSignal } from './lifecycle.ts';
import { startServerSentry } from './sentry.ts';
import { loadWorkerPushTransport } from './test-hooks-loader.ts';

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
// The runtime-test stack records pushes instead of sending them (PHASE_04 T4.9); everywhere else: the real service.
const testTransport = await loadWorkerPushTransport(env, logger, redis);
// Cloudflare purge (T6.4 media by URL, T8.2 takedowns by tag): never locally — nothing is in front of the local stack.
const purger =
  env.APP_ENV !== 'local' && env.CF_API_TOKEN_PURGE && env.CF_ZONE_ID
    ? cloudflarePurger({ token: env.CF_API_TOKEN_PURGE, zoneId: env.CF_ZONE_ID })
    : undefined;
const jobs = await startJobWorkers({
  ...(purger ? { cdnPurger: purger } : {}),
  db,
  connection: redis,
  ledger: redisSendLedger(redis),
  sender: createPushSender({
    vapid: { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
    ...(testTransport ? { transport: testTransport } : {}),
  }),
  logger,
  ...(sentry ? { report: sentry.report } : {}),
  // T6.4: deleted posts' files go with them after 180 days — the worker's own Cloudinary key and the Cloudflare purge
  // token (both required outside local); locally there is neither, and the job leaves files (logged).
  retention: {
    // Never locally — local work must not delete in the real account even with real keys (#165 L8).
    ...(env.APP_ENV !== 'local' && env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET
      ? {
          media: cloudinaryMediaStore({
            cloudName: env.CLOUDINARY_CLOUD_NAME,
            apiKey: env.CLOUDINARY_API_KEY,
            apiSecret: env.CLOUDINARY_API_SECRET,
          }),
        }
      : {}),
    ...(purger ? { purger } : {}),
    mediaOrigin: env.MEDIA_ORIGIN,
    // T8.7: closed legal orders' encrypted documents (3 years) — same rule: never in the real account locally.
    ...(env.APP_ENV !== 'local' && env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET
      ? {
          privateFiles: cloudinaryPrivateStore({
            cloudName: env.CLOUDINARY_CLOUD_NAME,
            apiKey: env.CLOUDINARY_API_KEY,
            apiSecret: env.CLOUDINARY_API_SECRET,
          }),
        }
      : {}),
  },
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
