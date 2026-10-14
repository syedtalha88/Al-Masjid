// Validates the env files `infra/vps/make-env.sh` generates against the real schemas (verifier V-17, review S-M2):
//   node scripts/check-make-env.mjs <dir with staging/ and production/>
// Staging must boot as generated (placeholders pass). Production must refuse to boot, and only because the external
// service values are still empty — every generated value itself must be valid.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EnvError, loadServerEnv } from '../packages/shared/src/env.ts';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node scripts/check-make-env.mjs <dir>');

/** KEY=value lines of one generated env file. */
function read(environment, process) {
  return Object.fromEntries(
    readFileSync(join(dir, environment, `${process}.env`), 'utf8')
      .split('\n')
      .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  );
}

// Filled by the owner per phase (PROGRESS F31); empty in a fresh production set.
const EXTERNAL = {
  'api-public': ['MONGODB_URI_PUBLIC', 'TURNSTILE_SECRET'],
  'api-admin': ['MONGODB_URI_ADMIN', 'TURNSTILE_SECRET', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
  worker: ['MONGODB_URI_SYSTEM', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'CF_API_TOKEN_PURGE', 'CF_ZONE_ID'],
};

let failures = 0;
const report = (ok, label) => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}\n`);
  if (!ok) failures += 1;
};

for (const proc of Object.keys(EXTERNAL)) {
  try {
    loadServerEnv(proc, read('staging', proc));
    report(true, `staging ${proc}: boots as generated`);
  } catch (error) {
    report(false, `staging ${proc}: ${error instanceof EnvError ? error.message : String(error)}`);
  }
  try {
    loadServerEnv(proc, read('production', proc));
    report(false, `production ${proc}: booted although external values are empty`);
  } catch (error) {
    const names = error instanceof EnvError ? [...new Set(error.problems.map((problem) => problem.name))].sort() : [];
    const expected = [...EXTERNAL[proc]].sort();
    report(
      JSON.stringify(names) === JSON.stringify(expected),
      `production ${proc}: refuses only for the empty external values (${names.join(', ')})`,
    );
  }
}
process.exitCode = failures === 0 ? 0 : 1;
