// The musalli app's language, switched the way a person does it: Settings → Language → the language's own name
// (07 A11). For specs that set up data once (an admin publishes) and then look at the result in all four languages.
import { type AppLocale, expect, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';

/** Each language's own name, as the Language sheet lists it (@mc/i18n NATIVE_NAME). */
const NATIVE_NAME: Readonly<Record<AppLocale, string>> = { en: 'English', hi: 'हिन्दी', ur: 'اردو', te: 'తెలుగు' };

/**
 * Switches the app from `from` to `to` through Settings and waits until the document has the new language.
 *
 * @param from - the language the app shows now (the Language row shows its name).
 */
export async function switchAppLanguage(page: Page, from: AppLocale, to: AppLocale): Promise<void> {
  await page.goto(`${APP_URL}/settings`);
  await page
    .locator('section[data-screen]:not([inert])')
    .getByRole('button', { name: new RegExp(NATIVE_NAME[from]) })
    .first()
    .click();
  await page.getByRole('dialog').locator('label').filter({ hasText: NATIVE_NAME[to] }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(to);
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** A screenshot attached to the test report (`screens/<locale>/<name>.png`). */
export async function shotFor(page: Page, locale: AppLocale, name: string): Promise<void> {
  const file = await page.screenshot({ path: test.info().outputPath(`screens/${locale}/${name}.png`) });
  await test.info().attach(`${name}-${locale}`, { body: file, contentType: 'image/png' });
}
