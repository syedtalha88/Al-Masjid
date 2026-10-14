// Entrypoint: api-public (app.<domain>/api/v1/*). No business logic here (01 §3).
import { createLogger, createPublicApp, startHttpServer } from '@mc/api';

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
const { app } = createPublicApp({
  logger,
  release: env.RELEASE,
  trustedProxyMode: env.TRUSTED_PROXY_MODE,
  ...(sentry ? { reportError: sentry.report } : {}),
  ...(hooks ? { clock: hooks.clock, testRoutes: hooks.routes } : {}),
});
const server = await startHttpServer(app, env.PORT, '0.0.0.0', logger);
logger.info({ port: server.port, appEnv: env.APP_ENV }, 'api-public listening');

onShutdownSignal(async (signal) => {
  logger.info({ signal }, 'shutting down: draining in-flight requests');
  await server.shutdown();
  await sentry?.flush();
  logger.info('api-public stopped');
}, process);
