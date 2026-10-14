// Entrypoint: api-admin (admin.<domain>/api/admin/*, /api/super/*, /api/hooks/*). No business logic here.
import { createAdminApp, createLogger, startHttpServer } from '@mc/api';

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
// e2e hooks only for APP_ENV=local + NODE_ENV=test AND a runtime-test build (10 §3, DECISIONS #31).
const hooks = await loadTestHooks(env, 'api-admin', logger);
const { app } = createAdminApp({
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
  await sentry?.flush();
  logger.info('api-admin stopped');
}, process);
