// commit-msg hook: enforces Conventional Commits (CLAUDE.md §4.7), e.g. `feat(app): add tab bar`.
import { readFileSync } from 'node:fs';

const TYPES = ['feat', 'fix', 'test', 'chore', 'docs', 'refactor', 'perf', 'build', 'ci', 'style', 'revert'];
const PATTERN = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9-]+(,[a-z0-9-]+)*\\))?!?: \\S.{0,99}$`);

const file = process.argv[2];
if (!file) {
  process.stderr.write('check-commit-msg: missing commit message file argument\n');
  process.exit(1);
}

const subject = readFileSync(file, 'utf8').split(/\r?\n/)[0] ?? '';
if (subject.startsWith('Merge ') || subject.startsWith('Revert "') || PATTERN.test(subject)) process.exit(0);

process.stderr.write(
  [
    '',
    `✖ Commit subject does not follow Conventional Commits: "${subject}"`,
    `  Expected: <type>(<scope>): <summary>   types: ${TYPES.join(', ')}`,
    '  Example:  feat(app): add tab bar with scan button',
    '',
  ].join('\n'),
);
process.exit(1);
