import { expect, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';
import { followByCode, followedIds } from '../support/device.ts';

// PHASE_02 T2.10 — A13 Updates, 10 §6 journey 3: follow two masjids → Updates merges their feeds newest first →
// filter chips; infinite scroll across masjids (feed pages forced to 3 items so paging really happens); unseen dots
// clear after 1.5 s on screen, and the tab badge with them. Needs the dev seed (TESTA001, TESTB002).

interface Item {
  readonly publicId: string;
  readonly type: string;
  readonly publishedAt: string;
}

/** The API's own view: both masjids' complete feeds (brothers), merged newest first. */
async function expectedOrder(page: Page): Promise<Item[]> {
  const ids = await followedIds(page);
  const versions = (await (
    await page.request.get(`${APP_URL}/api/v1/masjids/versions?ids=${ids.join(',')}`)
  ).json()) as Record<string, { v: number }>;
  const items: Item[] = [];
  for (const id of ids) {
    const v = versions[id]?.v ?? 0;
    const page1 = (await (
      await page.request.get(`${APP_URL}/api/v1/masjids/${id}/feed?v=${String(v)}&aud=brothers`)
    ).json()) as { items: Item[] };
    items.push(...page1.items);
  }
  return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.publicId.localeCompare(b.publicId));
}

const rows = (page: Page) => page.locator('section[data-screen]:not([inert]) li[data-key]');
const shownIds = (page: Page) => rows(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-key')));

test('journey 3: two masjids merge newest first; chips filter; infinite scroll pages across masjids', async ({
  page,
  expectAxeClean,
  capture,
}) => {
  // Small pages: the merge has to page both masjids.
  await page.route('**/api/v1/masjids/*/feed?*', (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set('limit', '3');
    return route.continue({ url: url.toString() });
  });
  await page.goto(APP_URL);
  await followByCode(page, APP_URL, ['TESTA001', 'TESTB002']);
  const expected = await expectedOrder(page);
  expect(expected.length).toBeGreaterThan(6);

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Updates/ })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Updates' })).toBeVisible();
  await expect(rows(page).first()).toBeVisible();
  await expectAxeClean();
  await capture('updates');

  // Scroll to the end until everything is in, in exactly the API's merged order.
  await expect
    .poll(
      async () => {
        await page.locator('section[data-screen]:not([inert]) [data-screen-scroll]').evaluate((node) => {
          node.scrollTo(0, node.scrollHeight);
        });
        return (await shownIds(page)).length;
      },
      { timeout: 30_000 },
    )
    .toBe(expected.length);
  expect(await shownIds(page)).toEqual(expected.map((item) => item.publicId));

  // Dua chip: only dua requests, same order.
  await page
    .getByRole('radio', { name: 'Dua' })
    .or(page.getByRole('button', { name: 'Dua', exact: true }))
    .click();
  const duas = expected.filter((item) => item.type === 'dua_request').map((item) => item.publicId);
  await expect.poll(() => shownIds(page)).toEqual(duas);
});

test('unseen dots and the tab badge clear after the screen has been seen', async ({ page }) => {
  await page.goto(APP_URL);
  await followByCode(page, APP_URL, ['TESTA001']);
  const tab = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Updates/ });
  await expect(tab).toHaveAccessibleName(/^Updates\s*, \d+ new$/);
  await tab.click();
  await expect(page.locator('[data-unseen-dot]').first()).toBeVisible();
  // 1.5 s visible → seen; the badge goes now, the dots on the next visit.
  await expect(tab).toHaveAccessibleName('Updates', { timeout: 5000 });
  await page.reload();
  await expect(rows(page).first()).toBeVisible();
  await expect(page.locator('[data-unseen-dot]')).toHaveCount(0);
});
