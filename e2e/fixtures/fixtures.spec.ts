import { existsSync } from 'node:fs';
import { sep } from 'node:path';

import { expect, test } from '@mc/config/playwright';

import { APP_URL } from '../../playwright.config.ts';

// PHASE_00 T0.12: proves the shared e2e fixtures catch what they claim to — a CSP violation, an axe violation —
// and that the locale option and per-locale screenshots work. Fake pages are served by request interception
// on a reserved `.test` host, so nothing leaves the machine.

const FAKE = 'https://fixtures.test/';

test('the CSP guard records a blocked inline script (and fails any other test that has one)', async ({
  page,
  cspViolations,
}) => {
  await page.route(FAKE, (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'Content-Security-Policy': "script-src 'none'" },
      body: '<!doctype html><title>csp</title><p>x</p><script>document.title = "ran"</script>',
    }),
  );
  await page.goto(FAKE);
  await expect.poll(() => cspViolations.length).toBeGreaterThan(0);
  expect(cspViolations.join('\n')).toMatch(/script-src/);
  expect(await page.title()).toBe('csp');
  // Accepted here on purpose; any leftover entry fails the test at teardown.
  cspViolations.length = 0;
});

test('expectAxeClean fails on a real violation and names it', async ({ page, expectAxeClean }) => {
  await page.route(FAKE, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en"><title>axe</title><main><img src="data:,"><button></button></main></html>',
    }),
  );
  await page.goto(FAKE);
  await expect(expectAxeClean()).rejects.toThrow(/image-alt[\s\S]*button-name|button-name[\s\S]*image-alt/);
  await expectAxeClean({ disableRules: ['image-alt', 'button-name'] }); // the fixture's own escape hatch
});

test.describe('appLocale option', () => {
  test.use({ appLocale: 'ur' });

  test('boots the app in the chosen locale (RTL) and captures per-locale screenshots', async ({ page, capture }) => {
    await page.goto(APP_URL);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ur');
    const path = await capture('home');
    expect(path.endsWith(['ur', 'home.png'].join(sep))).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  test('a language the user picks later survives reloads', async ({ page }) => {
    await page.goto(APP_URL);
    await page.evaluate(() => {
      localStorage.setItem('mc.locale', 'te');
    });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'te');
  });
});
