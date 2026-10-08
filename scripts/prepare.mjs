// `prepare` lifecycle: installs the git hooks (lefthook) only in a git checkout. Skipped in Docker builds
// and other environments without .git / git, where hooks are meaningless.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('.git') || process.env['LEFTHOOK'] === '0') process.exit(0);
const result = spawnSync('pnpm', ['exec', 'lefthook', 'install'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
