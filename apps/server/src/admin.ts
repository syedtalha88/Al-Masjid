// Entrypoint: api-admin (admin.<domain>/api/admin/*, /api/super/*, /api/hooks/*). No business logic here.
import { createAdminApp, createLogger, startHttpServer } from '@mc/api';

import { bootEnv, onShutdownSignal } from './lifecycle.ts';

const env = bootEnv('api-admin', process);
const logger = createLogger({ process: 'api-admin', level: env.LOG_LEVEL, release: env.RELEASE });
const { app } = createAdminApp({ logger, release: env.RELEASE, trustedProxyMode: env.TRUSTED_PROXY_MODE });
const server = await startHttpServer(app, env.PORT, '0.0.0.0', logger);
logger.info({ port: server.port, appEnv: env.APP_ENV }, 'api-admin listening');

onShutdownSignal(async (signal) => {
  logger.info({ signal }, 'shutting down: draining in-flight requests');
  await server.shutdown();
  logger.info('api-admin stopped');
}, process);
