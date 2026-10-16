// The API processes' MongoDB handle and Redis client (PHASE_01 T1.6): each process uses only its own credentials
// (DECISIONS #7), the rate limiter writes under its ACL prefix, and `/health` pings both. Nothing here logs a
// connection string — Redis errors are logged by code only, once per outage.
import { type createLogger, type HealthProbes, type RateLimiter, redisRateLimiter } from '@mc/api';
import { createDbHandle, type DbHandle } from '@mc/db';
import { Redis } from 'ioredis';

type Logger = ReturnType<typeof createLogger>;

export interface ApiConnections {
  readonly db: DbHandle;
  readonly redis: Redis;
  readonly rateLimiter: RateLimiter;
  readonly health: HealthProbes;
  close(): Promise<void>;
}

export interface ApiConnectionConfig {
  readonly process: 'api-public' | 'api-admin';
  readonly mongoUri: string;
  readonly database: string;
  readonly redisUrl: string;
  /** APP_ENV=local: plain-text MongoDB allowed (Docker). */
  readonly local: boolean;
}

/**
 * Opens the process's connections. MongoDB connects lazily on first use; Redis connects now and reconnects by itself.
 * With the offline queue off, commands fail fast while Redis is down — rate limits then fall back to the in-memory
 * insurance limiter and `/health` reports `redis: down`.
 */
export function openApiConnections(config: ApiConnectionConfig, logger: Logger): ApiConnections {
  const db = createDbHandle({
    uri: config.mongoUri,
    database: config.database,
    process: config.process,
    local: config.local,
  });
  const redis = new Redis(config.redisUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    connectionName: config.process,
  });
  let down = false;
  redis.on('error', (error: unknown) => {
    if (down) return;
    down = true;
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown';
    logger.warn({ code }, 'redis unavailable (rate limits fall back to per-process memory)');
  });
  redis.on('ready', () => {
    if (down) logger.info('redis available again');
    down = false;
  });

  return {
    db,
    redis,
    rateLimiter: redisRateLimiter(redis, config.process === 'api-public' ? 'rl:pub:' : 'rl:adm:'),
    health: {
      db: async () => (await db.ping()).ok,
      redis: async () => {
        await redis.ping(); // rejects while Redis is down (offline queue off)
        return true;
      },
    },
    async close() {
      redis.disconnect();
      await db.close();
    },
  };
}
