import { expect, settle, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';
import { followByCode } from '../support/device.ts';
import { VISUAL_NOW } from './visual-now.ts';

// PHASE_02 T2.14 — visual baselines (10 §1 "key screens × 4 locales", journey 5 "screenshots match baseline"): every
// musalli screen of this phase in en / hi / ur / te, compared pixel-wise. Deterministic by construction:
// - run only through `pnpm test:visual` — inside the pinned Playwright Linux image (the same pixels locally and in CI)
//   after the database was reset and seeded as of VISUAL_NOW (`SEED_NOW`), so items, Ramadan / Eid dates and "2 hours
//   ago" never move and no Ameen counts carry over from other specs;
// - the page clock is fixed at VISUAL_NOW and the API's `Date` header is dropped (the app would correct the clock);
// - no service worker, animations off, carets hidden; screenshots in CSS pixels (small files).
// Masjid photos are ThumbHash placeholders (no media server in the test stack).

test.use({ serviceWorkers: 'block' });

const LOCALES = ['en', 'hi', 'ur', 'te'] as const;

/**
 * Waits until the top screen shows its final content: requests done (counts fill in as feed pages arrive), no skeleton
 * left, fonts loaded, motion settled.
 */
async function ready(page: Page) {
  const screen = page.locator('section[data-screen]:not([inert])');
  await expect(screen.locator('h1').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(screen.locator('.skeleton')).toHaveCount(0);
  await expect(page.locator('[role="status"][aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await settle(page);
}

async function pinClock(page: Page) {
  await page.clock.setFixedTime(new Date(VISUAL_NOW));
  await page.route('**/api/v1/**', async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers['date'];
    await route.fulfill({ response, headers });
  });
}

const OPTIONS = { scale: 'css', animations: 'disabled', caret: 'hide' } as const;

const shot = async (page: Page, locale: string, name: string) => {
  await ready(page);
  await expect(page).toHaveScreenshot([locale, `${name}.png`], OPTIONS);
};

for (const locale of LOCALES) {
  test.describe(locale, () => {
    test.use({ appLocale: locale });

    test(`musalli screens (${locale})`, async ({ page }) => {
      test.slow();
      await pinClock(page);
      await page.goto(APP_URL);
      const [alpha] = await followByCode(page, APP_URL, ['TESTA001', 'TESTB002', 'TESTC003']);
      if (alpha === undefined) throw new Error('seed masjid missing');

      await shot(page, locale, 'home');
      for (const [name, path] of [
        ['my-masjids', '/masjids'],
        ['masjid-detail', `/masjid/${alpha}`],
        ['prayer-timings', `/masjid/${alpha}/timings`],
        ['updates', '/updates'],
        ['announcements', `/masjid/${alpha}/announcements`],
        ['hadith-quran', `/masjid/${alpha}/hadith`],
        ['dua-requests', `/masjid/${alpha}/duas`],
        ['settings', '/settings'],
      ] as const) {
        await page.goto(`${APP_URL}${path}`);
        await shot(page, locale, name);
      }
    });

    test.describe('first launch', () => {
      test.use({ appDevice: 'fresh' });

      test(`onboarding welcome (${locale})`, async ({ page }) => {
        await pinClock(page);
        await page.goto(APP_URL);
        await expect(page.locator('h1').first()).toBeVisible();
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await settle(page);
        await expect(page).toHaveScreenshot([locale, 'onboarding-welcome.png'], OPTIONS);
      });
    });
  });
}
