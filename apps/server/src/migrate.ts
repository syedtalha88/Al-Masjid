// Entrypoint: one-off migration container. The migration runner arrives in Phase 1 (T1.x); until then
// this only validates its env (so the deploy pipeline's migrate step is exercised) and exits.
import { createLogger } from '@mc/api';

import { bootEnv } from './lifecycle.ts';
import { startServerSentry } from './sentry.ts';

const env = bootEnv('migrate', process);
const logger = createLogger({ process: 'migrate', level: env.LOG_LEVEL, release: env.RELEASE });
const sentry = startServerSentry({
  dsn: env.SENTRY_DSN,
  release: env.RELEASE,
  environment: env.APP_ENV,
  process: 'migrate',
});
logger.info({ appEnv: env.APP_ENV }, 'no migrations yet — the migration runner is added in Phase 1');
await sentry?.flush();
