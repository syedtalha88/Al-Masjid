import { APP_LOCALES, expect, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';
import { followByCode } from '../support/device.ts';

// PHASE_03 T3.16 — A21 "Ask the masjid": the dev seed lists two Ilm contacts on Test Masjid Alpha (TESTA001), one for
// brothers and one for sisters (fake numbers +91000000000{1,2}). A brothers device sees only the brothers' contact and a
// sisters device only the sisters' one; the number is never on screen (text or attribute); "Message" opens wa.me with
// the greeting in the app language. Test Masjid Beta (TESTB002) lists none → no row. Needs the dev seed.

const screen = (page: Page) => page.locator('section[data-screen]:not([inert])');
const ROW: Readonly<Record<string, string>> = {
  en: 'Ask the masjid',
  hi: 'मस्जिद से पूछें',
  ur: 'مسجد سے پوچھیں',
  te: 'మస్జిద్‌ను అడగండి',
};
const GREETING: Readonly<Record<string, string>> = {
  en: 'Assalamu alaikum',
  hi: 'अस्सलामु अलैकुम',
  ur: 'السلام علیکم',
  te: 'అస్సలాము అలైకుమ్',
};

/** Follows a seed masjid, opens Masjid Detail and taps "Ask the masjid" (the in-app path). */
async function openIlm(page: Page, row: string): Promise<void> {
  await page.goto(APP_URL);
  const [masjidId = ''] = await followByCode(page, APP_URL, ['TESTA001']);
  await page.goto(`${APP_URL}/masjid/${masjidId}`);
  await screen(page).getByRole('button', { name: row }).click();
  await expect(page.locator('[data-ilm-list] [data-ilm-contact]').first()).toBeVisible();
}

/** Every text node and attribute value of the list (the number must be in none). */
const everything = (page: Page) =>
  page.locator('[data-ilm-list]').evaluate((root) => {
    const parts = [root.textContent];
    for (const element of [root, ...root.querySelectorAll('*')]) {
      for (const attribute of element.attributes) parts.push(attribute.value);
    }
    return parts.join('\n');
  });

for (const [audience, own, other, number] of [
  ['brothers', 'Test Contact Brother', 'Test Contact Sister', '910000000001'],
  ['sisters', 'Test Contact Sister', 'Test Contact Brother', '910000000002'],
] as const) {
  test.describe(`A21 on a ${audience} device`, () => {
    test.use({ appAudience: audience });

    test(`only the ${audience}’ contact; no number on screen; Message opens wa.me with the greeting`, async ({
      page,
      context,
    }) => {
      // wa.me is answered locally: the test checks where the button goes, not WhatsApp.
      await context.route('https://wa.me/**', (route) => route.fulfill({ status: 200, body: 'ok' }));
      await openIlm(page, ROW['en'] ?? '');
      const list = page.locator('[data-ilm-list]');
      await expect(list.locator('[data-ilm-contact]')).toHaveCount(1);
      await expect(list.getByText(own)).toBeVisible();
      await expect(list.getByText(other)).toHaveCount(0);
      expect(await everything(page)).not.toMatch(/0000000|\+91|wa\.me/);

      const popup = page.waitForEvent('popup');
      await list.getByRole('button', { name: `Message ${own} on WhatsApp` }).click();
      const url = new URL((await popup).url());
      expect(`${url.origin}${url.pathname}`).toBe(`https://wa.me/${number}`);
      expect(url.searchParams.get('text')).toBe(GREETING['en']);
    });
  });
}

test('a masjid without contacts for this device shows no "Ask the masjid" row', async ({ page }) => {
  await page.goto(APP_URL);
  const [masjidId = ''] = await followByCode(page, APP_URL, ['TESTB002']);
  await page.goto(`${APP_URL}/masjid/${masjidId}`);
  // The row comes from the bundle, which the heading needs too.
  await expect(screen(page).getByRole('heading', { level: 1, name: /Test Masjid Beta/ })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(screen(page).getByRole('button', { name: ROW['en'] ?? '' })).toHaveCount(0);
});

for (const locale of APP_LOCALES) {
  test.describe(`A21 Ask the masjid (${locale})`, () => {
    test.use({ appLocale: locale });

    test('intro, the contact card and its Message button in the app language', async ({
      page,
      context,
      expectAxeClean,
      capture,
    }) => {
      await context.route('https://wa.me/**', (route) => route.fulfill({ status: 200, body: 'ok' }));
      await openIlm(page, ROW[locale] ?? '');
      await expect(page.getByRole('heading', { level: 1, name: ROW[locale] ?? '' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === 'ur' ? 'rtl' : 'ltr');
      expect(await everything(page)).not.toMatch(/0000000|\+91|wa\.me/);
      const popup = page.waitForEvent('popup');
      await page.locator('[data-ilm-contact]').getByRole('button').click();
      expect(new URL((await popup).url()).searchParams.get('text')).toBe(GREETING[locale]);
      await page.bringToFront();
      await expectAxeClean();
      await capture('a21-ilm');
    });
  });
}
