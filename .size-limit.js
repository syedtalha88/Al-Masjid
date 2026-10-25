// `pnpm size` — bundle budgets (01 §9), checked on the production builds of both PWAs (run their `build` first;
// CI builds before this step). Gzip, as the budgets are written. Entries come from each build's index.html, so
// hashed file names never need updating:
//   initial JS  = the entry script + every chunk it modulepreloads (what the browser must run to show `/`)
//   initial CSS = the stylesheets index.html links
//   lazy chunks = every other JS file in dist/assets, each on its own (≤ 60 kB)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Musalli `/`: 175 kB — 01 §9 says 170 kB; the offline data layer (validated contracts, device store, persisted cache,
 * T2.3) needs +5.8 kB even after dropping the ICU parser and moving to Zod Mini (DECISIONS #92, owner rule "quality
 * over bundle size"); 176 kB since T2.4 (onboarding gate + shared-chunk split, +0.3 kB); 180 kB since T2.5 (follow routes + the follow flow's
 * success check make rolldown split Motion into two preloaded shared chunks: +~1 kB code, +~3 kB lost gzip context —
 * DECISIONS #94); 184 kB at T2.6 (Home); 182 kB since T2.7 —
 * the versions poller left the entry (F43, part 1); 181 kB since T2.9 — one module per glyph (F43, part 2); 184 kB since
 * T2.11 — the content screens share more of Motion and intl-messageformat, so rolldown splits them into more preloaded
 * chunks (+3.1 kB, mostly lost gzip context; owner 24 Oct 2026: "10–20 kB is fine, focus on quality" — DECISIONS #100).
 */
const APP_INITIAL_JS = '184 kB';
const ADMIN_INITIAL_JS = '220 kB';
const INITIAL_CSS = '25 kB';
const LAZY_CHUNK = '60 kB';

const ASSET = /(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g;

/**
 * @param {'app' | 'admin'} app
 * @param {string} initialJsLimit
 * @returns {import('size-limit').SizeLimitConfig}
 */
function checks(app, initialJsLimit) {
  const dist = join('apps', app, 'dist');
  const indexHtml = join(dist, 'index.html');
  if (!existsSync(indexHtml)) {
    throw new Error(`size-limit: ${indexHtml} is missing — run \`pnpm --filter @mc/${app} build\` first.`);
  }
  const linked = [...readFileSync(indexHtml, 'utf8').matchAll(ASSET)].map((match) => match[1] ?? '');
  const initialJs = linked.filter((file) => file.endsWith('.js'));
  const initialCss = linked.filter((file) => file.endsWith('.css'));
  if (initialJs.length === 0) throw new Error(`size-limit: no entry script found in ${indexHtml}`);
  const lazy = readdirSync(join(dist, 'assets'))
    .filter((file) => file.endsWith('.js'))
    .map((file) => `assets/${file}`)
    .filter((file) => !initialJs.includes(file));

  return [
    { name: `${app}: initial JS`, path: initialJs.map((file) => join(dist, file)), limit: initialJsLimit, gzip: true },
    { name: `${app}: initial CSS`, path: initialCss.map((file) => join(dist, file)), limit: INITIAL_CSS, gzip: true },
    ...lazy.map((file) => ({
      // Keep the hash: each locale has its own `common-*` / `errors-*` catalogue chunk.
      name: `${app}: lazy ${file.replace(/^assets\//, '')}`,
      path: join(dist, file),
      limit: LAZY_CHUNK,
      gzip: true,
    })),
  ];
}

export default [...checks('app', APP_INITIAL_JS), ...checks('admin', ADMIN_INITIAL_JS)];
