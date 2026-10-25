// `pnpm test:visual` / `pnpm test:visual:update` (PHASE_02 T2.14, DECISIONS #103): the visual baselines, compared or
// rewritten inside the pinned Playwright Linux image — screenshots differ between operating systems, so baselines are
// only ever made and checked there (locally and in CI the same pixels).
//   1. resets the local database and writes the seed as of VISUAL_NOW (`SEED_NOW`): dates, prayer times, relative
//      labels and Ameen counts are the same on every run;
//   2. runs the `visual-*` Playwright projects in the image against the running stack (`pnpm stack:up`).
// Linux (CI): the repository is mounted as is and the container uses the host network. Windows / macOS: the host's
// node_modules cannot run in Linux, so the sources are copied into a volume and installed there (pnpm store cached in
// a volume); the container joins Caddy's network namespace; baselines and results are copied back.
// Afterwards the database holds the fixed-date seed: `pnpm db:reset` restores today's.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const update = process.argv.includes('--update');

/** Same version as @playwright/test (package.json), pinned by digest. */
const IMAGE =
  'mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27';
const pinned = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies['@playwright/test'];
if (!IMAGE.includes(`:v${pinned}-`)) {
  process.stderr.write(`visual: the image (${IMAGE}) does not match @playwright/test ${pinned} — update both\n`);
  process.exit(1);
}

const visualNow = /export const VISUAL_NOW = '([^']+)'/.exec(
  readFileSync(join(root, 'e2e/visual/visual-now.ts'), 'utf8'),
)?.[1];
if (!visualNow) throw new Error('VISUAL_NOW not found in e2e/visual/visual-now.ts');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(process.execPath, ['scripts/db-reset.ts']);
run(process.execPath, ['scripts/seed-dev.ts'], { env: { ...process.env, SEED_NOW: visualNow } });

const playwright = [
  'pnpm exec playwright test --project=visual-pixel-7 --project=visual-iphone-14 --workers=2',
  update ? '--update-snapshots=all' : '',
  '--reporter=line',
].join(' ');
const hosts = 'printf "127.0.0.1 app.localhost admin.localhost\\n" >> /etc/hosts';
// Docker on Windows reads `C:\…` paths; Git Bash must not rewrite the container paths.
const env = { ...process.env, MSYS_NO_PATHCONV: '1' };

if (process.platform === 'linux') {
  run(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'host',
      '--ipc',
      'host',
      '-e',
      'CI',
      '-v',
      `${root}:/repo`,
      '-w',
      '/repo',
      IMAGE,
      'bash',
      '-c',
      `set -e; ${hosts}; corepack enable >/dev/null; ${playwright}`,
    ],
    { env },
  );
} else {
  const shots = join(root, 'e2e/visual/__screenshots__');
  const results = join(root, 'test-results/visual');
  mkdirSync(shots, { recursive: true });
  mkdirSync(results, { recursive: true });
  const script = [
    'set -e',
    hosts,
    'mkdir -p /work && cd /work',
    // Sources only; the baselines come back through their own mount.
    "tar -C /src --exclude=./.git --exclude='node_modules' --exclude='dist' --exclude='dist-test' --exclude=./test-results " +
      "--exclude='coverage' --exclude='.turbo' -cf - . | tar -xf -",
    'rm -rf e2e/visual/__screenshots__ && cp -r /shots e2e/visual/__screenshots__',
    'corepack enable >/dev/null',
    'pnpm install --frozen-lockfile --ignore-scripts --store-dir /pnpm-store --reporter=silent',
    `${playwright} || status=$?`,
    'cp -r e2e/visual/__screenshots__/. /shots/',
    'cp -r test-results/. /results/ 2>/dev/null || true',
    'exit ${status:-0}',
  ].join('\n');
  run(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'container:mc-dev-caddy-1',
      '--ipc',
      'host',
      '-v',
      `${root}:/src:ro`,
      '-v',
      `${shots}:/shots`,
      '-v',
      `${results}:/results`,
      '-v',
      'mc-visual-pnpm-store:/pnpm-store',
      // Corepack's and pnpm's own downloads (the pnpm binary), so a run does not fetch them again.
      '-v',
      'mc-visual-cache:/root/.cache',
      IMAGE,
      'bash',
      '-c',
      script,
    ],
    { env },
  );
}
