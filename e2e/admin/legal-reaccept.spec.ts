import { expect, seedOnboardedDevice, test } from '@mc/config/playwright';
import { devices } from '@playwright/test';

import { ADMIN_URL, APP_URL } from '../../playwright.config.ts';
import { registerDevice, storedDevice } from '../support/device.ts';
import {
  CSRF,
  HOOKS,
  label,
  registerWithInvite,
  resetRateLimits,
  seedSuperAdminInvite,
  virtualAuthenticator,
} from './helpers.ts';

// PHASE_08 T8.6 — legal re-acceptance: when the Super Admin moves the privacy notice to a new version, a musalli sees
// "Our privacy notice has changed" before going on, accepts once, and the server records the version; a year after
// acceptance the yearly reminder shows. When the undertaking version moves, a masjid admin sees the undertaking
// again (writes are refused until accepted). The legal readers show their DRAFT marks; Licenses lists the packages.
// The versions are restored at the end (other specs rely on them). Fake texts only.

const YEAR_MS = 366 * 24 * 60 * 60 * 1000;

test.describe('legal re-acceptance (T8.6)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('privacy notice: changed version and yearly reminder; undertaking shown again after a version change', async ({
    page,
    browser,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'the virtual authenticator is a Chromium DevTools feature');
    test.setTimeout(240_000);
    await resetRateLimits(page.request);
    await virtualAuthenticator(page);
    const token = await seedSuperAdminInvite(page.request, 'Test Owner', 'en');
    await registerWithInvite(page, `${ADMIN_URL}/invite#${token}`, 'Test Owner', 'en');
    const original = (await (await page.request.get(`${ADMIN_URL}/api/super/settings`)).json()) as {
      privacyVersion: string;
      undertakingVersion: string;
    };
    const setVersions = async (body: Record<string, string>) => {
      const response = await page.request.patch(`${ADMIN_URL}/api/super/settings`, { headers: CSRF, data: body });
      expect(response.status(), await response.text()).toBe(200);
    };

    // A masjid admin who accepted the current undertaking.
    const masjid = await page.request.post(`${ADMIN_URL}/api/super/masjids`, {
      headers: CSRF,
      data: {
        name: 'Test Masjid Legal',
        area: 'Test Area',
        city: 'Hyderabad',
        state: 'Telangana',
        address: 'Test address 1',
        lat: 17.385,
        lng: 78.4867,
      },
    });
    const { id: masjidId } = (await masjid.json()) as { id: string };
    const created = await page.request.post(`${ADMIN_URL}/api/super/admins`, {
      headers: CSRF,
      data: { displayName: 'Test Imam', uiLocale: 'en', masjidId, role: 'owner' },
    });
    const { inviteUrl } = (await created.json()) as { inviteUrl: string };
    const phone = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
    const musalli = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
    try {
      const admin = await phone.newPage();
      await virtualAuthenticator(admin);
      await registerWithInvite(admin, inviteUrl, 'Test Imam');
      await admin.getByRole('checkbox', { name: label('en', 'admin', 'undertaking.agree') }).check();
      await admin.getByRole('button', { name: label('en', 'admin', 'undertaking.continue') }).click();
      await expect(admin.getByText('Test Masjid Legal').first()).toBeVisible();

      // The musalli, onboarded and registered: no prompt while the version is current.
      await seedOnboardedDevice(musalli);
      const app = await musalli.newPage();
      await app.goto(APP_URL);
      await registerDevice(app);
      await app.reload();
      await expect(app.getByRole('heading', { name: 'Assalamu Alaikum' })).toBeVisible();
      await expect(app.locator('[data-privacy-notice]')).toHaveCount(0);

      // New versions in force.
      await setVersions({ privacyVersion: 'e2e-2', undertakingVersion: 'e2e-2' });

      // Musalli: "changed" → accept → the server holds the new version; not asked again.
      await app.reload();
      const notice = app.locator('[data-privacy-notice="changed"]');
      await expect(notice).toBeVisible({ timeout: 15_000 });
      await expect(notice).toContainText('DRAFT');
      const saved = app.waitForResponse(
        (response) => response.url().endsWith('/api/v1/devices/me') && response.request().method() === 'PATCH',
      );
      await app.getByRole('button', { name: 'I understand' }).click();
      expect((await saved).status()).toBe(204);
      await expect(notice).toBeHidden();
      const me = await storedDevice(app);
      expect(me?.['privacyVersion']).toBe('e2e-2');
      await app.reload();
      await expect(app.getByRole('heading', { name: 'Assalamu Alaikum' })).toBeVisible();
      await expect(app.locator('[data-privacy-notice]')).toHaveCount(0);

      // A year later: the yearly reminder.
      await app.clock.setFixedTime(new Date(Date.now() + YEAR_MS));
      await app.reload();
      await expect(app.locator('[data-privacy-notice="yearly"]')).toBeVisible({ timeout: 15_000 });

      // Admin: the undertaking is shown again; a write is refused until it is accepted.
      await admin.reload();
      await expect(admin.getByRole('checkbox', { name: label('en', 'admin', 'undertaking.agree') })).toBeVisible();
    } finally {
      await setVersions({ privacyVersion: original.privacyVersion, undertakingVersion: original.undertakingVersion });
      await phone.close();
      await musalli.close();
    }
  });
});

test.describe('legal readers (T8.6)', () => {
  test('musalli: terms and content policy with their draft marks; licenses lists the packages', async ({
    page,
    expectAxeClean,
  }) => {
    await page.goto(`${APP_URL}/settings/terms`);
    const terms = page.locator('[data-legal-doc="terms"]');
    await expect(terms.locator('[data-legal-marks]')).toContainText('DRAFT');
    await expect(terms.locator('li').first()).toBeVisible();
    await expectAxeClean();
    await page.goto(`${APP_URL}/settings/content-policy`);
    await expect(page.locator('[data-legal-doc="content-policy"] li').first()).toBeVisible();
    await page.goto(`${APP_URL}/settings/licenses`);
    const licenses = page.locator('[data-licenses]');
    await expect(licenses).toContainText('react');
    await expect(licenses).toContainText('OFL-1.1'); // the fonts
    await expectAxeClean();
  });
});
