import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const serverDir = fileURLToPath(new URL('..', import.meta.url));

/** Runs an entrypoint as a real child process (via tsx) with exactly `env` (+ PATH), and waits for exit. */
function runEntrypoint(
  file: string,
  env: Record<string, string>,
): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', file], {
      cwd: serverDir,
      env: { PATH: process.env['PATH'] ?? '', SystemRoot: process.env['SystemRoot'] ?? '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('exit', (code) => {
      resolve({ code, stderr, stdout });
    });
  });
}

const LOCAL_COMMON = {
  NODE_ENV: 'development',
  APP_ENV: 'local',
  MONGODB_DB_NAME: 'dev',
  APP_ORIGIN: 'http://localhost:5173',
  ADMIN_ORIGIN: 'http://localhost:5174',
  MEDIA_ORIGIN: 'http://localhost:8790',
  TRUSTED_PROXY_MODE: 'none',
};
const KEY = Buffer.alloc(32, 7).toString('base64');
const VAPID_PUBLIC = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 9)]).toString('base64url');

const SECRET = 'VALUE-MUST-NOT-BE-PRINTED';

// One real boot-failure test per process (T0.2 acceptance, DECISIONS #7).
const cases: [string, Record<string, string>, string][] = [
  [
    'src/public.ts',
    {
      ...LOCAL_COMMON,
      MONGODB_URI_PUBLIC: 'mongodb://mc_public:pw@localhost:27017/',
      REDIS_URL_PUBLIC: 'redis://rl_public:pw@localhost:6379',
      PORT: '8787',
    },
    'MONGODB_URI_ADMIN',
  ],
  [
    'src/admin.ts',
    {
      ...LOCAL_COMMON,
      MONGODB_URI_ADMIN: 'mongodb://mc_admin:pw@localhost:27017/',
      REDIS_URL_ADMIN: 'redis://admin:pw@localhost:6379',
      SESSION_PEPPER: KEY,
      FIELD_ENCRYPTION_KEY: KEY,
      FIELD_ENCRYPTION_KEY_ID: 'k1',
      RP_ID: 'localhost',
      VAPID_PUBLIC_KEY: VAPID_PUBLIC,
      PAYMENT_HOLD_MINUTES: '2',
      PORT: '8788',
    },
    'VAPID_PRIVATE_KEY',
  ],
  [
    'src/worker.ts',
    {
      ...LOCAL_COMMON,
      MONGODB_URI_SYSTEM: 'mongodb://mc_system:pw@localhost:27017/',
      REDIS_URL_WORKER: 'redis://worker:pw@localhost:6379',
      FIELD_ENCRYPTION_KEY: KEY,
      FIELD_ENCRYPTION_KEY_ID: 'k1',
      VAPID_PUBLIC_KEY: VAPID_PUBLIC,
      VAPID_PRIVATE_KEY: Buffer.alloc(32, 3).toString('base64url'),
      VAPID_SUBJECT: 'mailto:owner@example.com',
      PAYMENT_HOLD_MINUTES: '2',
    },
    'SESSION_PEPPER',
  ],
  [
    'src/migrate.ts',
    {
      NODE_ENV: 'development',
      APP_ENV: 'local',
      MONGODB_DB_NAME: 'dev',
      MONGODB_URI_MIGRATOR: 'mongodb://mc_migrator:pw@localhost:27017/',
    },
    'MONGODB_URI_SYSTEM',
  ],
];

describe('entrypoints refuse to boot with a forbidden variable', () => {
  it.each(cases)(
    '%s with %s → exit 1, name printed, value never printed',
    async (file, env, forbidden) => {
      const result = await runEntrypoint(file, { ...env, [forbidden]: SECRET });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('refusing to start');
      expect(result.stderr).toContain(`${forbidden}: forbidden in`);
      expect(result.stderr + result.stdout).not.toContain(SECRET);
    },
    30_000,
  );
});

describe('migrate entrypoint', () => {
  it('validates its env and exits 0 (no migrations before Phase 1)', async () => {
    const [, env] = cases[3] ?? ['', {}, ''];
    const result = await runEntrypoint('src/migrate.ts', env);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('no migrations yet');
  }, 30_000);
});
