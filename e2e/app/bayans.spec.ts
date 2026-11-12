import { APP_LOCALES, expect, test } from '@mc/config/playwright';
import type { Page, Request } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';
import { followByCode } from '../support/device.ts';

// PHASE_06 T6.3 — A12 Bayans, journey 10 (07 A12, DECISIONS #39): a sisters-only bayan never reaches a brothers device
// and is listed on a sisters device; list, detail and player make NO request to any Google / YouTube host before Play
// is tapped — then only the youtube-nocookie embed built from the stored id (and start second); offline, Play is not
// offered; CSP violation-free (fixture); 4 locales (Urdu mirrored), axe clean. Needs the dev seed: TESTD004 = Test
// Masjid Delta with "Test bayan for everyone" (seedD0000005) and "Test bayan for sisters" (seedD0000006, from 90 s).

const DELTA = 'TESTD004';
const EVERYONE = 'seedD0000005';
const SISTERS = 'seedD0000006';
const GOOGLE = /(^|\.)(google|googleapis|gstatic|googlevideo|youtube|youtube-nocookie|ytimg|youtu\.be|doubleclick)\./u;
const ROW: Readonly<Record<string, string>> = { en: 'Bayans', hi: 'बयान', ur: 'بیانات', te: 'బయాన్‌లు' };

const screen = (page: Page) => page.locator('section[data-screen]:not([inert])');

/** Every request this page makes to a Google / YouTube host, from now on. */
function watchGoogle(page: Page): string[] {
  const hits: string[] = [];
  page.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (GOOGLE.test(`${url.hostname}.`)) hits.push(request.url());
  });
  return hits;
}

/** Opens Delta's Bayans list from Masjid Detail. */
async function openBayans(page: Page, row = ROW['en'] ?? '') {
  await page.goto(APP_URL);
  const [delta = ''] = await followByCode(page, APP_URL, [DELTA]);
  await page.goto(`${APP_URL}/masjid/${delta}`);
  await screen(page)
    .getByRole('button', { name: new RegExp(`^${row}`, 'u') })
    .click();
  await expect(page).toHaveURL(`${APP_URL}/masjid/${delta}/bayans`);
  return delta;
}

test.describe('A12 on a brothers device (journey 10)', () => {
  test.use({ appAudience: 'brothers' });

  test('only the everyone bayan; no Google request before Play; then the nocookie embed', async ({
    page,
    context,
    expectAxeClean,
    capture,
  }) => {
    const google = watchGoogle(page);
    // The embed is answered locally once Play is tapped: the test checks where the player goes, not YouTube.
    await context.route('https://www.youtube-nocookie.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>embed</title>' }),
    );
    await openBayans(page);
    const list = screen(page).locator('[data-bayans]');
    await expect(list.locator('[data-video-card]')).toHaveCount(1);
    await expect(list.getByText('Test bayan for everyone')).toBeVisible();
    await expect(list.getByText('Test bayan for sisters')).toHaveCount(0);
    await expect(list.getByText('YouTube')).toBeVisible();
    await expectAxeClean();
    await capture('a12-bayans');

    await list.locator(`[data-video-card="${EVERYONE}"]`).click();
    await expect(page).toHaveURL(`${APP_URL}/items/${EVERYONE}`);
    const facade = screen(page).locator('[data-video-facade]');
    await expect(facade.getByText('Plays from YouTube')).toBeVisible();
    await expect(screen(page).locator('iframe')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await expectAxeClean();
    await capture('a12-player');
    expect(google, 'no Google / YouTube request before Play').toEqual([]);

    await facade.getByRole('button', { name: 'Play Test bayan for everyone' }).click();
    const frame = screen(page).locator('[data-video-player] iframe');
    await expect(frame).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/TestBayan01?autoplay=1&rel=0&playsinline=1',
    );
    await expect(frame).toHaveAttribute('title', 'Test bayan for everyone');
    expect(google.every((url) => url.startsWith('https://www.youtube-nocookie.com/embed/TestBayan01'))).toBe(true);
  });

  test('a sisters-only bayan opened by its link is not shown to a brothers device', async ({ page }) => {
    await page.goto(APP_URL);
    await followByCode(page, APP_URL, [DELTA]);
    await page.goto(`${APP_URL}/items/${SISTERS}`);
    await expect(screen(page).getByText('Test bayan for sisters')).toHaveCount(0);
    await expect(screen(page).locator('[data-video-facade]')).toHaveCount(0);
  });

  test('offline: no Play — "Connect to the internet to watch"', async ({ page, context }) => {
    await openBayans(page);
    await screen(page).locator(`[data-video-card="${EVERYONE}"]`).click();
    const facade = screen(page).locator('[data-video-facade]');
    await expect(facade.getByRole('button', { name: /^Play / })).toBeVisible();
    await context.setOffline(true);
    try {
      await expect(facade.getByRole('status')).toHaveText(/Connect to the internet to watch/);
      await expect(facade.getByRole('button')).toHaveCount(0);
      await expect(screen(page).locator('iframe')).toHaveCount(0);
    } finally {
      await context.setOffline(false);
    }
  });
});

test.describe('A12 on a sisters device (journey 10)', () => {
  test.use({ appAudience: 'sisters' });

  test('both bayans listed; the sisters one plays from its start second', async ({ page, context }) => {
    const google = watchGoogle(page);
    await context.route('https://www.youtube-nocookie.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>embed</title>' }),
    );
    await openBayans(page);
    const list = screen(page).locator('[data-bayans]');
    await expect(list.locator('[data-video-card]')).toHaveCount(2);
    await list.locator(`[data-video-card="${SISTERS}"]`).click();
    await page.waitForLoadState('networkidle');
    expect(google).toEqual([]);
    await screen(page).getByRole('button', { name: 'Play Test bayan for sisters' }).click();
    await expect(screen(page).locator('[data-video-player] iframe')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/TestBayan02?autoplay=1&rel=0&playsinline=1&start=90',
    );
  });
});

for (const locale of APP_LOCALES) {
  test.describe(`A12 Bayans (${locale})`, () => {
    test.use({ appLocale: locale });

    test('list and player in the app language; Urdu mirrored; axe clean', async ({ page, expectAxeClean, capture }) => {
      await openBayans(page, ROW[locale] ?? '');
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === 'ur' ? 'rtl' : 'ltr');
      await expect(screen(page).locator('[data-video-card]')).toHaveCount(1);
      await expectAxeClean();
      await capture('a12-bayans');
      await screen(page).locator(`[data-video-card="${EVERYONE}"]`).click();
      await expect(screen(page).locator('[data-video-facade]')).toBeVisible();
      await expectAxeClean();
      await capture('a12-player');
    });
  });
}
