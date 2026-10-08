// Checks the local Docker services are configured securely (run: pnpm --filter @mc/server verify:local).
// Reads the git-ignored local env files itself; prints only PASS/FAIL lines, never credentials.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Redis } from 'ioredis';

const root = fileURLToPath(new URL('../../../', import.meta.url));

function env(file: string, name: string): string {
  const line = readFileSync(`${root}${file}`, 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));
  if (line === undefined) throw new Error(`${name} missing in ${file} — run pnpm setup:local`);
  return line.slice(name.length + 1);
}

let failures = 0;
function check(label: string, ok: boolean): void {
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}\n`);
}

async function redisCase(url: string | undefined, run: (redis: Redis) => Promise<unknown>): Promise<boolean> {
  const redis =
    url === undefined ? new Redis(6379, '127.0.0.1', { lazyConnect: true }) : new Redis(url, { lazyConnect: true });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    await run(redis);
    return true;
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}

// --- Redis ---------------------------------------------------------------------------------------------
const worker = env('.env.local.worker', 'REDIS_URL_WORKER');
const publicUrl = env('.env.local.api-public', 'REDIS_URL_PUBLIC');

check('redis: unauthenticated PING is rejected (default user off)', !(await redisCase(undefined, (r) => r.ping())));
check('redis: worker can write bull:*', await redisCase(worker, (r) => r.set('bull:verify', '1', 'EX', 10)));
check('redis: worker cannot write rl:pub:*', !(await redisCase(worker, (r) => r.set('rl:pub:verify', '1'))));
check('redis: rl_public can write rl:pub:*', await redisCase(publicUrl, (r) => r.set('rl:pub:verify', '1', 'EX', 10)));
check('redis: rl_public cannot touch bull:*', !(await redisCase(publicUrl, (r) => r.get('bull:verify'))));
check('redis: FLUSHALL is denied', !(await redisCase(worker, (r) => r.flushall())));
check('redis: KEYS is denied', !(await redisCase(worker, (r) => r.keys('*'))));
check('redis: CONFIG is denied', !(await redisCase(worker, (r) => r.config('GET', 'maxmemory-policy'))));
check(
  'redis: INFO allowed (needed by ioredis/BullMQ) and policy is noeviction',
  await redisCase(worker, async (r) => {
    const info = await r.info('memory');
    if (!info.includes('maxmemory_policy:noeviction')) throw new Error('wrong policy');
  }),
);

// --- MongoDB (via mongosh inside the container; the driver arrives in Phase 1) ------------------------
function mongosh(args: string[]): { ok: boolean; out: string } {
  try {
    const out = execFileSync('docker', ['exec', 'mc-dev-mongo-1', 'mongosh', '--quiet', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out };
  } catch (error) {
    const out = error instanceof Error && 'stdout' in error ? String(error.stdout) : '';
    return { ok: false, out };
  }
}

const unauth = mongosh(['--eval', 'db.getSiblingDB("admin").runCommand({ listDatabases: 1 }).ok']);
check('mongo: unauthenticated listDatabases is rejected', !unauth.ok || !unauth.out.trim().endsWith('1'));

const rootPassword = env('.env.local.compose', 'MONGO_ROOT_PASSWORD');
const rs = mongosh([
  '-u',
  'root',
  '-p',
  rootPassword,
  '--authenticationDatabase',
  'admin',
  '--eval',
  'const s = rs.status(); print(s.set + " " + s.members[0].stateStr)',
]);
check('mongo: replica set rs0 with a PRIMARY (transactions available)', rs.ok && rs.out.includes('rs0 PRIMARY'));

process.stdout.write(
  failures === 0 ? '\nAll local service checks passed.\n' : `\n${String(failures)} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
