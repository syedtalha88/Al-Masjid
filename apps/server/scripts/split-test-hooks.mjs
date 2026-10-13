// Post-build step and build check (10 §3, DECISIONS #31): moves the test-hook entry out of dist/ into
// dist-test/, then fails unless no shipped file in dist/ contains test-hook code and dist-test/ does.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const MARKER = 'mc-test-hooks-module';
const dist = 'dist';
const distTest = 'dist-test';

rmSync(distTest, { recursive: true, force: true });
mkdirSync(distTest);
for (const file of ['test-hooks.mjs', 'test-hooks.mjs.map']) {
  if (existsSync(join(dist, file))) renameSync(join(dist, file), join(distTest, file));
}

const problems = [];
if (!existsSync(join(distTest, 'test-hooks.mjs'))) problems.push('dist-test/test-hooks.mjs was not built');
else if (!readFileSync(join(distTest, 'test-hooks.mjs'), 'utf8').includes(MARKER))
  problems.push('dist-test/test-hooks.mjs does not contain the test-hook module');
for (const file of readdirSync(dist).filter((name) => name.endsWith('.mjs'))) {
  const code = readFileSync(join(dist, file), 'utf8');
  if (code.includes(MARKER) || code.includes("'/test/clock'")) problems.push(`dist/${file} contains test-hook code`);
}
if (problems.length > 0) {
  process.stderr.write(`split-test-hooks: FAILED\n  ${problems.join('\n  ')}\n`);
  process.exit(1);
}
process.stdout.write('split-test-hooks: dist/ has no test-hook code; dist-test/test-hooks.mjs ready\n');
