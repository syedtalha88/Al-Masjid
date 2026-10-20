import { expect, test } from '@mc/config/playwright';
import { devices } from '@playwright/test';

import { ADMIN_URL } from '../../playwright.config.ts';
import {
  HOOKS,
  me,
  registerWithInvite,
  resetRateLimits,
  seedSuperAdminInvite,
  virtualAuthenticator,
} from './helpers.ts';

// PHASE_01 T1.11 (with T1.8/T1.10): the whole onboarding in the real admin app. The Super Admin creates a masjid
// and its admin (C2) and gets the login link; the admin opens it on their own phone (another browser context with its
// own passkey), creates a login, accepts the undertaking (B2) and lands on home (B3) with the masjid; then the Super
// Admin can activate the masjid (activation needs an admin who has logged in and accepted the undertaking).
// Fake names only (10 §Fixtures).

test.describe('masjid onboarding (T1.11)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('Super Admin adds a masjid + admin → the admin registers and accepts → the masjid can be activated', async ({
    page,
    browser,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'the virtual authenticator is a Chromium DevTools feature');
    await resetRateLimits(page.request);
    const run = Date.now().toString(36);
    const masjidName = `E2E Test Masjid ${run}`;
    const adminName = `E2E Test Imam ${run}`;

    // Super Admin.
    await virtualAuthenticator(page);
    const token = await seedSuperAdminInvite(page.request, 'E2E Owner');
    await registerWithInvite(page, `${ADMIN_URL}/invite#${token}`, 'E2E Owner');

    // C2: a new masjid.
    await page.goto(`${ADMIN_URL}/super/masjids`);
    await page.getByRole('button', { name: 'New masjid' }).click();
    await page.getByLabel('Name (English)').fill(masjidName);
    await page.getByLabel('Area', { exact: true }).fill('Test Area');
    await page.getByLabel('City', { exact: true }).fill('Hyderabad');
    await page.getByLabel('State', { exact: true }).fill('Telangana');
    await page.getByLabel('Address', { exact: true }).fill('Test address 1');
    await page.getByLabel('Location', { exact: true }).fill('17.3850, 78.4867');
    await page.getByRole('button', { name: 'Create masjid' }).click();
    await page.getByText(masjidName).click();
    await expect(page.getByRole('heading', { name: masjidName })).toBeVisible();

    // Its admin, and the one-time login link.
    await page.getByRole('button', { name: 'Add admin' }).click();
    await page.getByLabel('Name', { exact: true }).fill(adminName);
    await page.getByRole('button', { name: 'Create admin' }).click();
    const sheet = page.getByRole('dialog', { name: 'Login link ready' });
    await expect(sheet).toBeVisible();
    const inviteUrl = (await sheet.getByText(/\/invite#/).innerText()).trim();
    expect(new URL(inviteUrl).origin).toBe(new URL(ADMIN_URL).origin);

    // The admin's own phone: another context, another passkey.
    const phone = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
    try {
      const adminPage = await phone.newPage();
      await virtualAuthenticator(adminPage);
      await registerWithInvite(adminPage, inviteUrl, adminName);
      // B2: the undertaking comes before anything else.
      await expect(adminPage.getByRole('heading', { name: 'Before you start' })).toBeVisible();
      const agree = adminPage.getByRole('checkbox', { name: 'I have read and I agree' });
      await agree.check();
      await adminPage.getByRole('button', { name: 'Continue' }).click();
      // B3: home with the masjid.
      await expect(adminPage.getByText(masjidName).first()).toBeVisible();
      const body = (await (await me(adminPage)).json()) as {
        undertakingRequired: boolean;
        masjids: { name: string }[];
      };
      expect(body.undertakingRequired).toBe(false);
      expect(body.masjids.map((m) => m.name)).toEqual([masjidName]);
    } finally {
      await phone.close();
    }

    // Back on the Super Admin's screen: the masjid can now be activated.
    await page.reload();
    await page.getByRole('button', { name: 'Activate' }).click();
    const confirm = page.getByRole('dialog', { name: 'Confirm it’s you' });
    if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
  });
});
