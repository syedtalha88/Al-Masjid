// `pnpm i18n:check` / `pnpm i18n:review` (09 §3).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCALES } from '../src/locales.ts';
import { buildReviewCsv, checkLocales, unreviewedCount } from './check.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const command = process.argv[2];
const targets = LOCALES.filter((locale) => locale !== 'en');

if (command === 'review') {
  mkdirSync(join(root, 'review'), { recursive: true });
  for (const locale of targets) {
    writeFileSync(join(root, 'review', `${locale}.csv`), buildReviewCsv(root, locale));
    process.stdout.write(
      `wrote review/${locale}.csv (${String(unreviewedCount(root, locale))} strings awaiting review)\n`,
    );
  }
} else if (command === 'check') {
  const problems = checkLocales(root);
  for (const problem of problems) {
    const where = [problem.locale, problem.namespace, problem.key].filter(Boolean).join(' › ');
    process.stdout.write(`✖ [${problem.kind}] ${where}: ${problem.message}\n`);
  }
  const unreviewed = targets.map((locale) => `${locale}: ${String(unreviewedCount(root, locale))}`).join(', ');
  process.stdout.write(`\nStrings awaiting human translation review — ${unreviewed}\n`);
  if (problems.length > 0) {
    process.stdout.write(`\ni18n:check failed with ${String(problems.length)} problem(s).\n`);
    process.exit(1);
  }
  process.stdout.write('i18n:check passed.\n');
} else {
  process.stderr.write('usage: tsx tools/cli.ts <check|review>\n');
  process.exit(2);
}
