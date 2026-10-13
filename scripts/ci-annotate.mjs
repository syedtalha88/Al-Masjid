// CI failure diagnostics as a GitHub annotation: runs a command and publishes the tail of its output as one
// `::error` annotation (annotations are visible on the run page and through the public API, unlike raw logs).
//   node scripts/ci-annotate.mjs "<title>" <command> [args…]
import { spawnSync } from 'node:child_process';

const [title = 'diagnostics', command, ...args] = process.argv.slice(2);
if (!command) {
  process.stderr.write('usage: node scripts/ci-annotate.mjs "<title>" <command> [args…]\n');
  process.exit(2);
}
const result = spawnSync(command, args, { encoding: 'utf8' });
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  // eslint-disable-next-line no-control-regex -- strip ANSI colour codes
  .replace(/\u001b\[[0-9;]*m/g, '')
  .trim();
process.stdout.write(`${output}\n`);
// Annotation messages are capped; keep the end, where the error usually is. Newlines are %0A-encoded.
const tail = output.length > 6000 ? `…${output.slice(-6000)}` : output;
const escape = (text) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
process.stdout.write(`::error title=${escape(title).replace(/[:,]/g, ' ')}::${escape(tail || '(no output)')}\n`);
