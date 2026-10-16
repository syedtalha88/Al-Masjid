// Entrypoint: one-off migration container (`docker compose run --rm migrate`, PHASE_01 T1.2). Holds only the
// migrator's credential (DECISIONS #7); applies pending migrations in order under the runner's lock, logs the ids, and
// exits 0 — or 1 with the error (never the connection string) so a deploy stops before new code meets an old schema.
import { createLogger } from '@mc/api';
import { migrateDatabase } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';

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

try {
  const { applied, skipped } = await migrateDatabase(env.MONGODB_URI_MIGRATOR, env.MONGODB_DB_NAME, MIGRATIONS);
  logger.info({ appEnv: env.APP_ENV, applied, alreadyApplied: skipped.length }, 'migrations done');
} catch (error) {
  // The driver's messages name hosts, never credentials; still log only the class and message.
  const message = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
  logger.error({ appEnv: env.APP_ENV, error: message }, 'migrations failed');
  sentry?.report(error);
  process.exitCode = 1;
} finally {
  await sentry?.flush();
}
