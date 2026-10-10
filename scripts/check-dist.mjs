// `pnpm check:dist` — production builds must not ship dev-only code or development fixtures
// (PHASE_00 T0.10 "/_dev/* absent from production build"; 10 §5 religious-content policy). Run after
// `pnpm --filter @mc/app build` and `pnpm --filter @mc/admin build`; exits 1 with every hit listed.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const APPS = ['apps/app/dist', 'apps/admin/dist'];

/** Strings that only exist in dev-only code or fixtures. */
export const FORBIDDEN = [
  'data-showcase-section', // the component showcase markup
  'Component showcase', // its title
  'Sample transliteration — DEV ONLY', // 10 §5 placeholders
  'نص تجريبي للعرض فقط',
  'DEV-SAMPLE',
  'Test Masjid',
];

const TEXT = /\.(js|mjs|css|html|json|webmanifest|txt|svg)$/;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return TEXT.test(name) ? [path] : [];
  });
}

const problems = [];
for (const dist of APPS) {
  const dir = join(root, dist);
  if (!existsSync(dir)) {
    problems.push(`${dist}: missing — build the app first`);
    continue;
  }
  for (const path of files(dir)) {
    const content = readFileSync(path, 'utf8');
    for (const marker of FORBIDDEN) {
      if (content.includes(marker)) problems.push(`${relative(root, path)}: contains "${marker}"`);
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(
    `Dev-only content found in production builds:\n${problems.map((line) => `  ${line}`).join('\n')}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `check:dist — ${String(APPS.length)} production builds clean (${String(FORBIDDEN.length)} markers).\n`,
);
