// Wrapper for local Docker Compose commands (`pnpm db:start`, `db:stop`, `stack:up`, `stack:down`).
// Checks prerequisites and prints a clear message instead of a cryptic compose error.
//   node scripts/compose.mjs <dev|stack> <up|down|logs|ps> [extra compose args…]
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [target = '', action = '', ...extra] = process.argv.slice(2);

const FILES = {
  dev: ['infra/compose/docker-compose.dev.yml'],
  stack: ['infra/compose/docker-compose.dev.yml', 'infra/compose/docker-compose.stack.yml'],
};
const ACTIONS = {
  // No --remove-orphans: dev and stack share one compose project, so `dev up` must not remove stack services.
  up: ['up', '-d', '--wait'],
  down: ['down'],
  logs: ['logs', '--tail', '100'],
  ps: ['ps'],
};

const files = FILES[/** @type {keyof typeof FILES} */ (target)];
const actionArgs = ACTIONS[/** @type {keyof typeof ACTIONS} */ (action)];
if (!files || !actionArgs) {
  process.stderr.write('usage: node scripts/compose.mjs <dev|stack> <up|down|logs|ps> [args…]\n');
  process.exit(2);
}

const required = ['.env.local.compose', 'infra/compose/.local/redis-users.acl', 'infra/compose/.local/mongo-keyfile'];
const missing = required.filter((file) => !existsSync(join(root, file)));
if (missing.length > 0) {
  process.stderr.write(`Missing local setup files: ${missing.join(', ')}\nRun \`pnpm setup:local\` first.\n`);
  process.exit(1);
}

const docker = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
if (docker.status !== 0) {
  process.stderr.write('Docker is not running (or not installed). Start Docker Desktop and try again.\n');
  process.exit(1);
}

const args = [
  'compose',
  '--project-directory',
  join(root, 'infra/compose'),
  '--env-file',
  join(root, '.env.local.compose'),
  ...files.flatMap((file) => ['-f', join(root, file)]),
  ...actionArgs,
  ...extra,
];
const result = spawnSync('docker', args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
