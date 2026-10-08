// Container healthcheck (Dockerfile HEALTHCHECK / compose): `node dist/healthcheck.mjs <process>`.
// api-public / api-admin: GET the local health route. worker: the Redis heartbeat key exists (01 §5.9).
// Exit 0 = healthy, 1 = unhealthy. Prints nothing on success; never prints env values.
import { loadServerEnv } from '@mc/shared/env';
import { Redis } from 'ioredis';

import { WORKER_HEARTBEAT_KEY } from './heartbeat.ts';

const TIMEOUT_MS = 3_000;

async function httpOk(port: number, path: string): Promise<boolean> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  return response.status === 200;
}

type Target = 'api-public' | 'api-admin' | 'worker';
const TARGETS: readonly string[] = ['api-public', 'api-admin', 'worker'] satisfies Target[];
const isTarget = (value: string | undefined): value is Target => value !== undefined && TARGETS.includes(value);

async function check(target: Target): Promise<boolean> {
  switch (target) {
    case 'api-public':
      return httpOk(loadServerEnv('api-public', process.env).PORT, '/api/v1/health');
    case 'api-admin':
      return httpOk(loadServerEnv('api-admin', process.env).PORT, '/api/admin/health');
    case 'worker': {
      const env = loadServerEnv('worker', process.env);
      const redis = new Redis(env.REDIS_URL_WORKER, {
        lazyConnect: true,
        connectTimeout: TIMEOUT_MS,
        maxRetriesPerRequest: 0,
      });
      redis.on('error', () => undefined);
      try {
        await redis.connect();
        return (await redis.exists(WORKER_HEARTBEAT_KEY)) === 1;
      } finally {
        redis.disconnect();
      }
    }
  }
}

const target = process.argv[2];
const healthy = isTarget(target) ? await check(target).catch(() => false) : false;
process.exit(healthy ? 0 : 1);
