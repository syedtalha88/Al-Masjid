// Entrypoint: api-admin (admin.<domain>/api/admin/*, /api/super/*, /api/hooks/*). No business logic here.
import {
  adminRoutes,
  alertService,
  clearRedisRateLimits,
  createAdminApp,
  createJobQueues,
  createLogger,
  keyRingFromEnv,
  mediaStoreFromEnv,
  pushNotifier,
  redisChallengeStore,
  sessionAuthenticator,
  startHttpServer,
} from '@mc/api';
import { BRAND } from '@mc/shared/brand';
import { systemClock } from '@mc/shared/clock';

import { openApiConnections } from './connections.ts';
import { bootEnv, onShutdownSignal } from './lifecycle.ts';
import { startServerSentry } from './sentry.ts';
import { loadTestHooks } from './test-hooks-loader.ts';

const env = bootEnv('api-admin', process);
const logger = createLogger({ process: 'api-admin', level: env.LOG_LEVEL, release: env.RELEASE });
const sentry = startServerSentry({
  dsn: env.SENTRY_DSN,
  release: env.RELEASE,
  environment: env.APP_ENV,
  process: 'api-admin',
});
const connections = openApiConnections(
  {
    process: 'api-admin',
    mongoUri: env.MONGODB_URI_ADMIN,
    database: env.MONGODB_DB_NAME,
    redisUrl: env.REDIS_URL_ADMIN,
    local: env.APP_ENV === 'local',
  },
  logger,
);
// The API only enqueues (after a publish commits); the worker sends (T4.4, 04 R7).
const queues = createJobQueues(connections.redis);
const pepper = Buffer.from(env.SESSION_PEPPER, 'base64'); // validated: ≥ 32 bytes (env.ts)
// e2e hooks only for APP_ENV=local + NODE_ENV=test AND a runtime-test build (10 §3, DECISIONS #31).
const hooks = await loadTestHooks(env, 'api-admin', logger, undefined, {
  admin: { db: connections.db, pepper, adminOrigin: env.ADMIN_ORIGIN },
  resetRateLimits: () => clearRedisRateLimits(connections.redis, 'rl:adm:'),
  redis: connections.redis,
});
const clock = hooks?.clock ?? systemClock;
const { app } = createAdminApp({
  adminOrigin: env.ADMIN_ORIGIN,
  authenticate: sessionAuthenticator({ db: connections.db, pepper, clock }),
  ...adminRoutes({
    db: connections.db,
    pepper,
    adminOrigin: env.ADMIN_ORIGIN,
    keyRing: keyRingFromEnv(env),
    // 04 §3: RP ID = the admin host (env.ts checks it equals ADMIN_ORIGIN's hostname), exact origin.
    rp: { id: env.RP_ID, name: BRAND.adminName, origin: env.ADMIN_ORIGIN },
    challenges: redisChallengeStore(connections.redis),
    logger,
    // T3.6: Cloudinary on staging/production, a local directory locally (MEDIA_STORE).
    media: { store: mediaStoreFromEnv(env), origin: env.MEDIA_ORIGIN },
    notifier: pushNotifier(queues, logger),
    // T4.6: alerts are enqueued here, sent by the worker; the Super Admin's test alert exists outside production only.
    alerts: alertService(queues, logger),
    testAlerts: env.APP_ENV !== 'production',
    // T5.2: the UPI change-lock hold (env.ts refuses < 1440 in production).
    paymentHoldMinutes: env.PAYMENT_HOLD_MINUTES,
  }),
  rateLimiter: connections.rateLimiter,
  health: connections.health,
  logger,
  release: env.RELEASE,
  trustedProxyMode: env.TRUSTED_PROXY_MODE,
  ...(sentry ? { reportError: sentry.report } : {}),
  ...(hooks ? { clock: hooks.clock, testRoutes: hooks.routes } : {}),
});
const server = await startHttpServer(app, env.PORT, '0.0.0.0', logger);
logger.info({ port: server.port, appEnv: env.APP_ENV }, 'api-admin listening');

onShutdownSignal(async (signal) => {
  logger.info({ signal }, 'shutting down: draining in-flight requests');
  await server.shutdown();
  await queues.close();
  await connections.close();
  await sentry?.flush();
  logger.info('api-admin stopped');
}, process);
