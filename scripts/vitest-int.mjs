// `pnpm test:int` runner for one package (cwd): integration tests (`*.int.test.ts`) against the Docker
// MongoDB/Redis (10 §1). Loads `.env.local.test` (written by `pnpm setup:local`) when present — CI sets
// MONGODB_URI_TEST / REDIS_URL_TEST itself — and switches `@mc/config/vitest` to integration mode.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const envFile = join(root, '.env.local.test');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const result = spawnSync('pnpm', ['exec', 'vitest', 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, MC_TEST_KIND: 'integration' },
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
