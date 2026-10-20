import { axeViolations, expect, test } from '@mc/config/playwright';
import { devices, type Page } from '@playwright/test';

import { ADMIN_URL } from '../../playwright.config.ts';
import {
  CSRF,
  HOOKS,
  label,
  type Locale,
  registerWithInvite,
  resetRateLimits,
  seedSuperAdminInvite,
  virtualAuthenticator,
} from './helpers.ts';

// PHASE_01 T1.10 acceptance: every Phase 01 admin screen in en / hi / ur / te — screenshot + axe (WCAG 2.1 AA, no
// violation of any impact); Urdu renders right-to-left. Masjid-admin screens (B1 invite, B2 undertaking, B3 home, B13
// account) and the Super Admin screens (C1, C2 list/detail/new/edit, C10, C11). Needs the runtime-test stack
// (E2E_TEST_HOOKS=1). Fake names only (10 §Fixtures).

const LOCALES: readonly Locale[] = ['en', 'hi', 'ur', 'te'];

async function settled(page: Page, path: string): Promise<void> {
  await page.goto(`${ADMIN_URL}${path}`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

for (const locale of LOCALES) {
  test.describe(`admin screens (${locale})`, () => {
    test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');
    test.use({ appLocale: locale });

    test('every screen: screenshot + axe clean', async ({ page, browser, browserName, capture, expectAxeClean }) => {
      test.skip(browserName !== 'chromium', 'the virtual authenticator is a Chromium DevTools feature');
      test.setTimeout(120_000);
      await resetRateLimits(page.request);
      const dir = locale === 'ur' ? 'rtl' : 'ltr';
      const shot = async (name: string) => {
        await expectAxeClean();
        await expect(page.locator('html')).toHaveAttribute('dir', dir);
        await capture(name);
      };

      // --- Super Admin ---
      await virtualAuthenticator(page);
      const token = await seedSuperAdminInvite(page.request, 'Test Owner', locale);
      await registerWithInvite(page, `${ADMIN_URL}/invite#${token}`, 'Test Owner', locale, async () => {
        await shot('b1-invite-super');
      });
      const masjid = await page.request.post(`${ADMIN_URL}/api/super/masjids`, {
        headers: CSRF,
        data: {
          name: `Test Masjid ${locale}`,
          area: 'Test Area',
          city: 'Hyderabad',
          state: 'Telangana',
          address: 'Test address 1',
          lat: 17.385,
          lng: 78.4867,
        },
      });
      expect(masjid.status()).toBe(201);
      const { id: masjidId } = (await masjid.json()) as { id: string };
      for (const [name, path] of [
        ['b3-home-super', '/'],
        ['c1-dashboard', '/super'],
        ['c2-masjids', '/super/masjids'],
        ['c2-masjid-new', '/super/masjids/new'],
        ['c2-masjid-detail', `/super/masjids/${masjidId}`],
        ['c2-masjid-edit', `/super/masjids/${masjidId}/edit`],
        ['c10-settings', '/super/settings'],
        ['c11-audit', '/super/audit'],
        ['b13-account-super', '/account'],
      ] as const) {
        await settled(page, path);
        await shot(name);
      }

      // --- a masjid admin on their own phone ---
      const created = await page.request.post(`${ADMIN_URL}/api/super/admins`, {
        headers: CSRF,
        data: { displayName: 'Test Imam', uiLocale: locale, masjidId, role: 'owner' },
      });
      expect(created.status()).toBe(201);
      const { inviteUrl } = (await created.json()) as { inviteUrl: string };
      const phone = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
      try {
        const adminPage = await phone.newPage();
        await virtualAuthenticator(adminPage);
        const adminShot = async (name: string) => {
          expect(await axeViolations(adminPage), `axe ${name}`).toEqual([]);
          await expect(adminPage.locator('html')).toHaveAttribute('dir', dir);
          const file = await adminPage.screenshot({ path: test.info().outputPath(`screens/${locale}/${name}.png`) });
          await test.info().attach(name, { body: file, contentType: 'image/png' });
        };
        await registerWithInvite(adminPage, inviteUrl, 'Test Imam', locale, () => adminShot('b1-invite-admin'));
        await expect(
          adminPage.getByRole('heading', { name: label(locale, 'admin', 'undertaking.title') }),
        ).toBeVisible();
        await adminShot('b2-undertaking');
        await adminPage.getByRole('checkbox', { name: label(locale, 'admin', 'undertaking.agree') }).check();
        await adminPage.getByRole('button', { name: label(locale, 'admin', 'undertaking.continue') }).click();
        await expect(adminPage.getByText(`Test Masjid ${locale}`).first()).toBeVisible();
        await adminShot('b3-home-admin');
        await adminPage.goto(`${ADMIN_URL}/account`);
        await adminPage.waitForLoadState('networkidle');
        await adminShot('b13-account-admin');
      } finally {
        await phone.close();
      }

      // B1 login (signed out).
      await page.request.post(`${ADMIN_URL}/api/admin/auth/logout`, { headers: CSRF });
      await settled(page, '/');
      await expect(page.getByRole('button', { name: label(locale, 'admin', 'login.button') })).toBeVisible();
      await shot('b1-login');
    });
  });
}
