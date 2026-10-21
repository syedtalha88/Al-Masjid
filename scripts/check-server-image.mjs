// `pnpm check:image <image> [--expect-hooks]` — DECISIONS #31 / 10 §3: the shipped `runtime` server image must
// contain no e2e test-hook module or code; the `runtime-test` image must (pass --expect-hooks). Runs Node inside
// the image itself (distroless has no shell) to list /app/dist and search every bundle for the module marker.
//   pnpm check:image mc-server:local                 (shipped image → no hooks)
//   pnpm check:image mc-server:test --expect-hooks   (e2e image → hooks present)
import { spawnSync } from 'node:child_process';

// The marker or any quoted hook route path, in any quote style (security review L1 / M-A) — one source of truth.
import { HOOK_CODE_SOURCE } from '../apps/server/scripts/hook-code.mjs';

const args = process.argv.slice(2);
const expectHooks = args.includes('--expect-hooks');
const image = args.find((arg) => !arg.startsWith('--'));
if (!image) {
  process.stderr.write('usage: node scripts/check-server-image.mjs <image> [--expect-hooks]\n');
  process.exit(2);
}

// Runs inside the container as the image's own non-root user; prints one JSON line.
const probe = `
const fs = require('node:fs');
const files = fs.readdirSync('/app/dist');
const hookCode = new RegExp(${JSON.stringify(HOOK_CODE_SOURCE)});
const withMarker = files.filter((file) => file.endsWith('.mjs') && hookCode.test(fs.readFileSync('/app/dist/' + file, 'utf8')));
const extraDirs = fs.readdirSync('/app').filter((name) => name.startsWith('dist') && name !== 'dist');
console.log(JSON.stringify({ hookFile: files.includes('test-hooks.mjs'), withMarker, extraDirs }));
`;
const run = spawnSync(
  'docker',
  ['run', '--rm', '--network', 'none', '--read-only', '--entrypoint', '/nodejs/bin/node', image, '-e', probe],
  { encoding: 'utf8' },
);
if (run.status !== 0) {
  process.stderr.write(`check-server-image: could not inspect ${image}\n${run.stderr}`);
  process.exit(1);
}
/** @type {{ hookFile: boolean, withMarker: string[], extraDirs: string[] }} */
const found = JSON.parse(run.stdout.trim().split('\n').pop() ?? '{}');

const problems = [];
if (expectHooks) {
  if (!found.hookFile) problems.push('dist/test-hooks.mjs is missing');
  if (JSON.stringify(found.withMarker) !== JSON.stringify(['test-hooks.mjs']))
    problems.push(`hook code expected only in test-hooks.mjs, found in: ${found.withMarker.join(', ') || 'none'}`);
} else {
  if (found.hookFile) problems.push('dist/test-hooks.mjs is present');
  if (found.withMarker.length > 0) problems.push(`test-hook code in: ${found.withMarker.join(', ')}`);
}
if (found.extraDirs.length > 0) problems.push(`unexpected build folders in /app: ${found.extraDirs.join(', ')}`);

if (problems.length > 0) {
  process.stderr.write(`check-server-image: ${image} FAILED\n  ${problems.join('\n  ')}\n`);
  process.exit(1);
}
process.stdout.write(`check-server-image: ${image} OK (${expectHooks ? 'test hooks present' : 'no test hooks'})\n`);
