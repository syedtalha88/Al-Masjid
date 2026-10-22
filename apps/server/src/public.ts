// Entrypoint: api-public (app.<domain>/api/v1/*). No business logic here (01 §3).
import {
  apiPublicRoutes,
  createLogger,
  createPublicApp,
  deviceAuthenticator,
  startHttpServer,
  turnstileVerifier,
} from '@mc/api';
import { systemClock } from '@mc/shared/clock';

import { openApiConnections } from './connections.ts';
import { bootEnv, onShutdownSignal } from './lifecycle.ts';
import { startServerSentry } from './sentry.ts';
import { loadTestHooks } from './test-hooks-loader.ts';

const env = bootEnv('api-public', process);
const logger = createLogger({ process: 'api-public', level: env.LOG_LEVEL, release: env.RELEASE });
const sentry = startServerSentry({
  dsn: env.SENTRY_DSN,
  release: env.RELEASE,
  environment: env.APP_ENV,
  process: 'api-public',
});
// e2e hooks only for APP_ENV=local + NODE_ENV=test AND a runtime-test build (10 §3, DECISIONS #31).
const hooks = await loadTestHooks(env, 'api-public', logger);
const connections = openApiConnections(
  {
    process: 'api-public',
    mongoUri: env.MONGODB_URI_PUBLIC,
    database: env.MONGODB_DB_NAME,
    redisUrl: env.REDIS_URL_PUBLIC,
    local: env.APP_ENV === 'local',
  },
  logger,
);
const clock = hooks?.clock ?? systemClock;
// Turnstile (04 §9): the widget runs on the app origin. Cloudflare's test secrets (local, and staging until the owner
// switches over — PROGRESS O8) answer with hostname example.com, so the hostname check applies to real secrets only;
// production refuses test secrets at boot (DECISIONS #59).
const turnstileSecret = env.TURNSTILE_SECRET ?? '1x0000000000000000000000000000000AA';
const turnstile = turnstileVerifier({
  secret: turnstileSecret,
  hostnames: /^[123]x0+AA$/.test(turnstileSecret) || !env.APP_ORIGIN ? null : [new URL(env.APP_ORIGIN).hostname],
});
const { app } = createPublicApp({
  authenticateDevice: deviceAuthenticator({ db: connections.db, clock }),
  routes: apiPublicRoutes({
    db: connections.db,
    turnstile,
    ...(env.APP_ORIGIN ? { appOrigin: env.APP_ORIGIN } : {}),
  }),
  rateLimiter: connections.rateLimiter,
  health: connections.health,
  logger,
  release: env.RELEASE,
  trustedProxyMode: env.TRUSTED_PROXY_MODE,
  ...(sentry ? { reportError: sentry.report } : {}),
  clock,
  ...(hooks ? { testRoutes: hooks.routes } : {}),
});
const server = await startHttpServer(app, env.PORT, '0.0.0.0', logger);
logger.info({ port: server.port, appEnv: env.APP_ENV }, 'api-public listening');

onShutdownSignal(async (signal) => {
  logger.info({ signal }, 'shutting down: draining in-flight requests');
  await server.shutdown();
  await connections.close();
  await sentry?.flush();
  logger.info('api-public stopped');
}, process);
