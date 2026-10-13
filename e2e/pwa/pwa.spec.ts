import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

import { ADMIN_URL, APP_URL } from '../../playwright.config.ts';
import { startStaticServer } from './static-server.ts';

// PHASE_00 T0.11 acceptance: both apps installable (CDP installability — DECISIONS #30), an offline reload
// shows the shell + offline banner, and a new deployment shows "Update available" whose Refresh applies it.

/** Waits until a service worker controls the page (first visit: after `clientsClaim`). */
async function controlled(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 20_000 });
}

for (const [name, url] of [
  ['app', APP_URL],
  ['admin', ADMIN_URL],
] as const) {
  test(`${name}: installable — no Chromium installability errors`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'installability is a Chromium DevTools query');
    await page.goto(url);
    await controlled(page);
    const cdp = await page.context().newCDPSession(page);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    expect(installabilityErrors).toEqual([]);
    const manifest: unknown = await page.evaluate(async () => {
      const response = await fetch('/manifest.webmanifest');
      const body: unknown = await response.json();
      return body;
    });
    expect(manifest).toMatchObject({ id: '/', display: 'standalone', start_url: '/?source=pwa' });
  });
}

test('admin service worker never caches /api', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Cache Storage inspection via Chromium');
  await page.goto(ADMIN_URL);
  await controlled(page);
  await page.evaluate(() => fetch('/api/admin/health').then((response) => response.text()));
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      urls.push(...(await cache.keys()).map((request) => request.url));
    }
    return urls;
  });
  expect(cached.length).toBeGreaterThan(0);
  expect(cached.filter((entry) => new URL(entry).pathname.startsWith('/api/'))).toEqual([]);
});

test('offline reload (Urdu): the shell, the cached locale and the offline banner', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', "Playwright's WebKit does not run service workers offline reliably");
  await page.goto(APP_URL);
  await page.evaluate(() => {
    localStorage.setItem('mc.locale', 'ur');
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await controlled(page);
  // The first visit's locale chunk and fonts are handed to the worker (CACHE_URLS); wait until every asset the
  // page loaded is in Cache Storage (precache or mc-assets). `expect.poll`, not `waitForFunction`: the latter
  // does not await an async predicate (a Promise is truthy), so the previous wait returned at once and the
  // test went offline before the locale chunks were stored (≈ 1 in 2 runs failed under parallel load).
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const assets = performance
          .getEntriesByType('resource')
          .map((entry) => new URL(entry.name))
          .filter((url) => url.origin === location.origin && url.pathname.startsWith('/assets/'));
        const cached = await Promise.all(assets.map((url) => caches.match(url.href, { ignoreSearch: true })));
        return assets.length > 0 && cached.every((response) => response !== undefined);
      }),
    )
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('section[data-screen]:not([inert]) h1')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('status').filter({ hasText: 'آپ آف لائن ہیں' })).toBeVisible();
  await expect(page.getByRole('navigation')).toBeVisible();
  await context.setOffline(false);
});

/** Production build of the musalli app into `outDir`, stamped with `release`. */
function build(outDir: string, release: string) {
  const result = spawnSync(
    'pnpm',
    ['--filter', '@mc/app', 'exec', 'vite', 'build', '--outDir', outDir, '--emptyOutDir'],
    {
      env: { ...process.env, MC_RELEASE: release },
      encoding: 'utf8',
      shell: process.platform === 'win32',
    },
  );
  if (result.status !== 0) throw new Error(`build failed:\n${result.stdout}\n${result.stderr}`);
}

test('update flow: a new deployment shows "Update available"; Refresh applies it', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'two-build flow verified on Chromium (service worker lifecycle)');
  test.setTimeout(180_000);
  const work = mkdtempSync(join(tmpdir(), 'mc-pwa-'));
  const first = join(work, 'a');
  const second = join(work, 'b');
  build(first, 'release-a');
  build(second, 'release-b');
  const server = await startStaticServer(first, 4280);
  try {
    await page.goto(server.url);
    await controlled(page);
    await expect(page.locator('meta[name="mc-release"]')).toHaveAttribute('content', 'release-a');
    // Deploy the second build, then let the app check for it (as it does hourly and on returning to the app).
    server.setRoot(second);
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });
    const refresh = page.getByRole('button', { name: 'Refresh' });
    await expect(
      page.getByText('A new version of the app is ready', { exact: true }).and(page.locator('p')),
    ).toBeVisible({ timeout: 20_000 });
    // Nothing reloads until the user asks.
    await expect(page.locator('meta[name="mc-release"]')).toHaveAttribute('content', 'release-a');
    await Promise.all([page.waitForEvent('load'), refresh.click()]);
    await expect(page.locator('meta[name="mc-release"]')).toHaveAttribute('content', 'release-b');
    await expect(
      page.getByText('A new version of the app is ready', { exact: true }).and(page.locator('p')),
    ).toHaveCount(0);
  } finally {
    await server.close();
    rmSync(work, { recursive: true, force: true });
  }
});

test('iOS home screen: touch icon, launch screens and app title are declared', async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-icon.png');
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Masjid');
  const splashes = page.locator('link[rel="apple-touch-startup-image"]');
  await expect(splashes).toHaveCount(10);
  const status = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-startup-image"]');
    return link ? (await fetch(link.href)).status : 0;
  });
  expect(status).toBe(200);
});
