// `pnpm lhci` — Lighthouse 13 against the built stack (`pnpm stack:up`), checked against the 01 §9 budgets
// (@mc/config/lighthouse). Default Lighthouse mobile profile = Moto G Power class, simulated Slow 4G, 4× CPU.
//   cold: RUNS fresh-storage runs per page (median), LCP ≤ 2.5 s
//   warm: the same page again without clearing storage, served by the service worker, LCP ≤ 1.0 s
// Each cold/warm pair gets its own browser profile, and the warm run a freshly started browser on it (F56): a repeat
// visit is the app opened again, not the same tab reloaded. In a reused tab Lighthouse's JS-coverage start walks the
// previous visit's heap on the main thread (a 300–500 ms "Unattributable" task at t≈8 ms that no user ever sees).
// Reports (HTML + JSON) go to .lighthouseci/. Uses Playwright's Chromium, so no separate Chrome install.
// Env: E2E_APP_URL / E2E_ADMIN_URL (default the local stack), LHCI_RUNS (default 3), LHCI_REPORT_ONLY=1 (staging, #85).
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

import {
  COLD_BUDGETS,
  evaluateBudgets,
  type LighthouseBudgets,
  median,
  type PageResult,
  type RunSummary,
  summarizeRun,
  WARM_BUDGETS,
} from '../packages/config/src/lighthouse.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(root, '.lighthouseci');
const PAGES = [
  process.env['E2E_APP_URL'] ?? 'https://app.localhost:8443/',
  process.env['E2E_ADMIN_URL'] ?? 'https://admin.localhost:8443/',
];
const RUNS = Number(process.env['LHCI_RUNS'] ?? '3');
if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error('LHCI_RUNS must be a positive integer');
/**
 * Staging only, until Phase 02 flattens the start chain (DECISIONS #85): Lighthouse's simulated Slow 4G charges the CDN's
 * observed server time to every level of the chain, so staging misses budgets the local stack (the hard gate) meets.
 */
const REPORT_ONLY = process.env['LHCI_REPORT_ONLY'] === '1';

mkdirSync(OUT, { recursive: true });

/** A free local port: chrome-launcher's own pick can collide when a profile is reopened (seen on Windows). */
async function freePort(): Promise<number> {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  server.close();
  if (address === null || typeof address === 'string') throw new Error('no free port');
  return address.port;
}

/** Chromium on `profile` (kept between launches: the warm run finds the service worker and caches). */
async function launch(profile: string): Promise<chromeLauncher.LaunchedChrome> {
  return chromeLauncher.launch({
    chromePath: chromium.executablePath(),
    userDataDir: profile,
    port: await freePort(),
    chromeFlags: [
      '--headless=new',
      // The local stack uses Caddy's internal CA; staging/CI targets have real certificates.
      '--ignore-certificate-errors',
      // Ubuntu 24.04 (CI runners) blocks the unprivileged user namespaces Chromium's sandbox needs; Playwright
      // launches without it by default for the same reason. We only audit our own pages.
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    ],
  });
}

/** Stops Chromium and waits until it has exited, so its profile can be opened again. */
async function close(chrome: chromeLauncher.LaunchedChrome): Promise<void> {
  const exited = chrome.process.exitCode === null ? once(chrome.process, 'exit') : Promise.resolve();
  chrome.kill();
  await exited;
}

/** One Lighthouse run in a freshly started browser on `profile`; `warm` keeps its storage from the cold run. */
async function run(url: string, label: string, profile: string, warm: boolean): Promise<RunSummary> {
  const chrome = await launch(profile);
  try {
    return await audit(chrome, url, label, warm);
  } finally {
    await close(chrome);
  }
}

/** Lighthouse on the page in `chrome`; writes the HTML + JSON report. */
async function audit(chrome: chromeLauncher.LaunchedChrome, url: string, label: string, warm: boolean) {
  const result = await lighthouse(url, {
    port: chrome.port,
    output: ['html', 'json'],
    logLevel: 'error',
    onlyCategories: ['performance', 'accessibility', 'best-practices'],
    disableStorageReset: warm,
  });
  if (!result) throw new Error(`lighthouse returned nothing for ${url}`);
  const [html, json] = Array.isArray(result.report) ? result.report : [result.report, ''];
  const base = join(OUT, `${new URL(url).hostname}-${label}`);
  writeFileSync(`${base}.html`, html ?? '');
  writeFileSync(`${base}.json`, json ?? '');
  return summarizeRun(result.lhr);
}

/** Writes one line to stdout (scripts print with process.stdout, not console). */
const out = (line: string) => process.stdout.write(`${line}\n`);

/** Median machine benchmark of all runs (Lighthouse benchmarkIndex; ≈ 1000+ is a fast desktop). */
let machine = 'unknown';

const print = (title: string, results: readonly PageResult[]) => {
  out(`\n${title}`);
  for (const page of results) {
    const scores = Object.entries(page.categories)
      .map(([id, score]) => `${id} ${String(Math.round(score * 100))}`)
      .join(' · ');
    const metrics = Object.entries(page.metrics)
      .map(
        ([id, value]) =>
          `${id} ${id === 'cumulative-layout-shift' ? value.toFixed(3) : `${String(Math.round(value))} ms`}`,
      )
      .join(' · ');
    out(`  ${page.failures.length === 0 ? 'PASS' : 'FAIL'} ${page.url} (median of ${String(page.runs)})`);
    out(`       ${scores}\n       ${metrics}`);
    for (const failure of page.failures) out(`       ✗ ${failure}`);
    for (const note of page.notes) out(`       ~ ${note} (DECISIONS #136)`);
    // In GitHub Actions, failures also become annotations (readable without signing in — DECISIONS #49).
    if (process.env['GITHUB_ACTIONS'] === 'true' && page.failures.length > 0) {
      const property = `Lighthouse ${title} ${page.url}`.replace(/:/g, '%3A').replace(/,/g, '%2C');
      const level = REPORT_ONLY ? 'warning' : 'error';
      out(
        `::${level} title=${property}::${[...page.failures, scores, metrics, `benchmarkIndex ${machine}`].join('%0A')}`,
      );
    }
  }
};

const cold: RunSummary[] = [];
const warm: RunSummary[] = [];
for (const url of PAGES) {
  for (let index = 1; index <= RUNS; index += 1) {
    const profile = mkdtempSync(join(tmpdir(), 'mc-lhci-'));
    try {
      cold.push(await run(url, `cold-${String(index)}`, profile, false));
      // After the cold run the service worker is installed and has cached the shell → a repeat visit.
      warm.push(await run(url, `warm-${String(index)}`, profile, true));
    } finally {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    }
  }
}
const index = median([...cold, ...warm].flatMap((summary) => summary.benchmarkIndex ?? []));
machine = index === undefined ? 'unknown' : String(Math.round(index));
out(`Machine benchmarkIndex (median): ${machine}`);
// Warm runs keep storage on purpose, so Lighthouse's "stored data may affect loading" warning is expected there.
for (const summary of cold) {
  for (const warning of summary.warnings) out(`  ! ${summary.url}: ${warning}`);
}
/** Prints one budget table; true when every page passed. */
const check = (title: string, runs: RunSummary[], budgets: LighthouseBudgets): boolean => {
  const results = evaluateBudgets(runs, budgets);
  print(title, results);
  return results.every((page) => page.failures.length === 0);
};
const passed = [
  check('Cold load (01 §9)', cold, COLD_BUDGETS),
  check('Warm load, service worker (01 §9)', warm, WARM_BUDGETS),
].every(Boolean);
// Warm TBT is reported, not gated (DECISIONS #51): show what the worst warm run spent its main thread on.
out('\nWarm start — long tasks of the worst run per page (TBT is reported, not gated; PROGRESS F27)');
for (const url of PAGES) {
  const runs = warm.filter((summary) => summary.url === url);
  const worst = runs.reduce<RunSummary | undefined>((acc, summary) => {
    const tbt = summary.metrics['total-blocking-time'] ?? 0;
    return acc === undefined || tbt > (acc.metrics['total-blocking-time'] ?? 0) ? summary : acc;
  }, undefined);
  const tasks = worst?.longTasks.map((task) => `${task.script} ${String(task.durationMs)} ms`).join(', ');
  out(
    `  ${url}: TBT ${String(Math.round(worst?.metrics['total-blocking-time'] ?? 0))} ms — ${tasks || 'no long tasks'}`,
  );
}
if (REPORT_ONLY && !passed)
  out('\nReport only (LHCI_REPORT_ONLY=1, DECISIONS #85): budget misses are printed, not enforced.');
process.exitCode = passed || REPORT_ONLY ? 0 : 1;
out(`\nReports: ${OUT}`);
