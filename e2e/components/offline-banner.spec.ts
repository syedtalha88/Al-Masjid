import { expect, settle, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

import { ADMIN_URL, APP_URL } from '../../playwright.config.ts';

// 08 §5.10 offline banner, both apps, LTR + RTL (verifier V-19): while online it sits entirely above the viewport —
// a pixel offset rendered as a percentage once left a 20 px strip of it on every screen, and the screenshot specs
// hide the banner, so this checks its real position.

const BANNER = '[data-offline-banner]';

async function bannerBottom(page: Page): Promise<number> {
  await settle(page);
  const box = await page.locator(BANNER).boundingBox();
  if (!box) throw new Error('offline banner not rendered');
  return box.y + box.height;
}

// Ready = the active screen's title. Signed out, the admin app shows its login screen (PHASE_01 T1.10 session gate);
// the banner lives outside the gate, so it is checked there.
for (const [app, url, ready] of [
  ['app', APP_URL, 'section[data-screen]:not([inert]) h1'],
  ['admin', ADMIN_URL, 'h1'],
] as const) {
  for (const locale of ['en', 'ur'] as const) {
    test.describe(`${app} (${locale})`, () => {
      test.use({ appLocale: locale });

      test('offline banner: hidden above the screen online, slides in offline, hides again', async ({
        page,
        context,
      }) => {
        await page.goto(url);
        await expect(page.locator(ready)).toBeVisible();
        expect(await bannerBottom(page)).toBeLessThanOrEqual(0);

        await context.setOffline(true);
        await expect(page.locator(`${BANNER} [role="status"]`)).not.toBeEmpty();
        await expect.poll(async () => (await page.locator(BANNER).boundingBox())?.y).toBeGreaterThanOrEqual(0);

        await context.setOffline(false);
        await expect(page.locator(`${BANNER} [role="status"]`)).toBeEmpty();
        await expect.poll(() => bannerBottom(page)).toBeLessThanOrEqual(0);
      });
    });
  }
}
