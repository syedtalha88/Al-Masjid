import { expect, test } from '@mc/config/playwright';
import type { BrowserContext, Page } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';
import { followByCode, followedIds } from '../support/device.ts';

// PHASE_02 T2.13 — 10 §6 journey 4 (offline): load, go offline, reload → Home, Prayer Timings and the feed render from
// the cache, with the offline banner (01 §5.6). Two ways to be offline:
// - connected without internet (both phones): every API request fails; the shell still loads, the persisted query
//   cache renders, and the banner shows because requests fail although `navigator.onLine` is true;
// - no network at all (Chromium): the service worker serves the shell and the versioned API from Cache Storage, marks
//   those answers (`X-MC-SW`), and `navigator.onLine` is false. Playwright's WebKit does not run service workers
//   offline reliably (as in e2e/pwa).
// Needs the dev seed (TESTA001).

const screen = (page: Page) => page.locator('section[data-screen]:not([inert])');
/** The banner's live region — a CSS locator: while hidden the banner is `aria-hidden`, so role queries skip it. */
const banner = (page: Page) => page.locator('[data-offline-banner] [role="status"]');
const OFFLINE_TEXT = 'You’re offline — showing saved information';

/** Query cache entries the app has written to IndexedDB (`mc-query-cache`), as their query hashes. */
async function persistedQueries(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const open = indexedDB.open('mc-query-cache');
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('kv')) {
            resolve([]);
            return;
          }
          const keys = db.transaction('kv').objectStore('kv').getAllKeys();
          keys.onsuccess = () => {
            resolve(keys.result.map(String));
          };
        };
        open.onerror = () => {
          resolve([]);
        };
      }),
  );
}

/** Follows Alpha, opens Home → Prayer Timings → Updates once online, and waits until all three are persisted. */
async function visitOnline(page: Page): Promise<string> {
  await page.goto(APP_URL);
  await followByCode(page, APP_URL, ['TESTA001']);
  const [masjidId = ''] = await followedIds(page);
  const card = page.getByRole('list', { name: 'My Masjids' }).locator(':scope > li').first();
  await expect(card.getByText('Test Masjid Alpha')).toBeVisible();
  await card.getByRole('button', { name: /Next Prayer/ }).click();
  await expect(screen(page).getByRole('table').getByRole('rowheader')).toHaveCount(6);
  await page.goBack();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Updates/ })
    .click();
  await expect(screen(page).locator('li[data-key]').first()).toBeVisible();
  // Back to Home (its root — each tab keeps its stack): the reload opens the URL shown.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Home/ }).click();
  await expect(page).toHaveURL(`${APP_URL}/`);
  // The cache is written per query when idle (lib/query/persist.ts).
  await expect
    .poll(async () => {
      const keys = (await persistedQueries(page)).join('\n');
      return ['"versions"', '"bundle"', '"feed"'].every((root) => keys.includes(root));
    })
    .toBe(true);
  return masjidId;
}

/** After the offline reload: Home, Prayer Timings and Updates render from the cache, the banner shows throughout. */
async function expectCachedApp(page: Page, capture: (name: string) => Promise<unknown>) {
  const card = page.getByRole('list', { name: 'My Masjids' }).locator(':scope > li').first();
  await expect(card.getByText('Test Masjid Alpha')).toBeVisible();
  await expect(banner(page)).toHaveText(OFFLINE_TEXT);
  await capture('offline-home');

  await card.getByRole('button', { name: /Next Prayer/ }).click();
  await expect(screen(page).getByRole('heading', { level: 1, name: 'Prayer Timings' })).toBeVisible();
  await expect(screen(page).getByRole('table').getByRole('rowheader')).toHaveCount(6);
  await expect(screen(page).getByRole('table').getByRole('row').filter({ hasText: 'Isha' })).toContainText('8:30 PM');
  await page.goBack();

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Updates/ })
    .click();
  await expect(screen(page).getByRole('heading', { level: 1, name: 'Updates' })).toBeVisible();
  await expect(screen(page).locator('li[data-key]').first()).toBeVisible();
  await expect(banner(page)).toHaveText(OFFLINE_TEXT);
}

test.describe('journey 4: connected without internet (API unreachable)', () => {
  // Page routes must see every API request (a worker's own requests bypass them).
  test.use({ serviceWorkers: 'block' });

  test('reload → Home, timings and feed from the persisted cache; the banner shows because requests fail', async ({
    page,
    expectAxeClean,
    capture,
  }) => {
    await visitOnline(page);
    await expect(banner(page)).toHaveText('');

    await page.route('**/api/**', (route) => route.abort('internetdisconnected'));
    await page.reload();
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    // Versions restored from the cache are seconds old here, so the start makes no request; the user returning to
    // the app polls them (`refetchOnWindowFocus: 'always'`) — as a reopen after 15 s does by itself.
    await expect(page.getByRole('list', { name: 'My Masjids' })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expectCachedApp(page, capture);
    await expectAxeClean();

    // The server answers again: the next request clears the banner (the versions poll runs when the app regains
    // focus — TanStack listens to `visibilitychange`).
    await page.unroute('**/api/**');
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expect(banner(page)).toHaveText('');
  });
});

test.describe('journey 4: no network (service worker)', () => {
  /** Waits until the worker controls the page and has stored the versioned API answers this page loaded. */
  async function cachedByWorker(page: Page) {
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const cache = await caches.open('mc-api-v1');
          const paths = (await cache.keys()).map((request) => new URL(request.url).pathname);
          return paths.some((path) => path.endsWith('/bundle')) && paths.some((path) => path.endsWith('/feed'));
        }),
      )
      .toBe(true);
  }

  async function goOffline(context: BrowserContext, page: Page) {
    await context.setOffline(true);
    await page.reload();
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  }

  test('offline reload → the worker serves the shell and the API; its answers are marked', async ({
    page,
    context,
    browserName,
    capture,
  }) => {
    test.skip(browserName !== 'chromium', "Playwright's WebKit does not run service workers offline reliably");
    // First visit installs the worker; the second visit's API requests go through it and are stored.
    await page.goto(APP_URL);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    const masjidId = await visitOnline(page);
    await cachedByWorker(page);

    await goOffline(context, page);
    await expectCachedApp(page, capture);

    // Stored answers say where they come from, so the app neither trusts their old `Date` nor counts them as online.
    const sources = await page.evaluate(async (id) => {
      const versions = await fetch(`/api/v1/masjids/versions?ids=${id}`);
      const body = (await versions.json()) as Record<string, { v: number }>;
      const bundle = await fetch(`/api/v1/masjids/${id}/bundle?v=${String(body[id]?.v ?? 0)}`);
      return [versions.headers.get('x-mc-sw'), bundle.headers.get('x-mc-sw')];
    }, masjidId);
    expect(sources).toEqual(['fallback', 'cache']);

    await context.setOffline(false);
    await expect(banner(page)).toHaveText('');
  });
});
