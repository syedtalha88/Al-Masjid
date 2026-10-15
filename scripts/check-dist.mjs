// `pnpm check:dist` — production builds must not ship dev-only code or development fixtures
// (PHASE_00 T0.10 "/_dev/* absent from production build"; 10 §5 religious-content policy). Run after
// `pnpm --filter @mc/app build` and `pnpm --filter @mc/admin build`; exits 1 with every hit listed.
//
// `--allow-showcase` (staging builds made with VITE_PUBLIC_SHOWCASE=true only — DECISIONS #58): the showcase
// must be present, and dev-only content may live only in lazily loaded JS chunks — never in a file that
// index.html loads or that the service worker precaches, so a normal visit never downloads it.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const APPS = ['apps/app/dist', 'apps/admin/dist'];
const allowShowcase = process.argv.includes('--allow-showcase');

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

/** Asset paths (relative to dist, `/` separators) that index.html or the service worker precache reference. */
function eagerAssets(dir) {
  const referenced = new Set();
  for (const name of ['index.html', 'sw.js']) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    for (const match of readFileSync(path, 'utf8').matchAll(/assets\/[\w.-]+/g)) referenced.add(match[0]);
  }
  return referenced;
}

const problems = [];
for (const dist of APPS) {
  const dir = join(root, dist);
  if (!existsSync(dir)) {
    problems.push(`${dist}: missing — build the app first`);
    continue;
  }
  const eager = allowShowcase ? eagerAssets(dir) : new Set();
  let showcaseFound = false;
  for (const path of files(dir)) {
    const content = readFileSync(path, 'utf8');
    const asset = relative(dir, path).split(sep).join('/');
    const lazyChunk = asset.startsWith('assets/') && asset.endsWith('.js') && !eager.has(asset);
    for (const marker of FORBIDDEN) {
      if (!content.includes(marker)) continue;
      if (marker === 'data-showcase-section') showcaseFound = true;
      if (allowShowcase && lazyChunk) continue;
      problems.push(
        `${relative(root, path)}: contains "${marker}"${allowShowcase ? ' (not a lazy, non-precached chunk)' : ''}`,
      );
    }
  }
  if (allowShowcase && !showcaseFound) problems.push(`${dist}: --allow-showcase but no showcase chunk was built`);
}

if (problems.length > 0) {
  process.stderr.write(
    `Dev-only content found in production builds:\n${problems.map((line) => `  ${line}`).join('\n')}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  allowShowcase
    ? `check:dist — ${String(APPS.length)} staging builds: showcase present, only in lazy non-precached chunks.\n`
    : `check:dist — ${String(APPS.length)} production builds clean (${String(FORBIDDEN.length)} markers).\n`,
);
