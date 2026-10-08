// Entrypoint: api-public (app.<domain>/api/v1/*). No business logic here (01 §3).
import { createLogger, createPublicApp, startHttpServer } from '@mc/api';

import { bootEnv, onShutdownSignal } from './lifecycle.ts';

const env = bootEnv('api-public', process);
const logger = createLogger({ process: 'api-public', level: env.LOG_LEVEL, release: env.RELEASE });
const { app } = createPublicApp({ logger, release: env.RELEASE, trustedProxyMode: env.TRUSTED_PROXY_MODE });
const server = await startHttpServer(app, env.PORT, '0.0.0.0', logger);
logger.info({ port: server.port, appEnv: env.APP_ENV }, 'api-public listening');

onShutdownSignal(async (signal) => {
  logger.info({ signal }, 'shutting down: draining in-flight requests');
  await server.shutdown();
  logger.info('api-public stopped');
}, process);
