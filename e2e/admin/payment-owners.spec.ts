import { axeViolations, expect, test } from '@mc/config/playwright';
import { type Browser, devices, type Page } from '@playwright/test';

import { ADMIN_URL } from '../../playwright.config.ts';
import {
  CSRF,
  HOOKS,
  registerWithInvite,
  resetRateLimits,
  seedSuperAdminInvite,
  virtualAuthenticator,
} from './helpers.ts';

// DECISIONS #161 (F69, security review L1–L3) in the admin app: an editor's B8 shows who may change the UPI details
// instead of "Set up UPI", and /payment has no form for them; an owner's request made from a session that is then
// signed out ("Sign out that device") is stopped at once, and B8 says so. Fake UPI IDs only (`@okexample`).

const run = Date.now().toString(36);

async function adminOn(browser: Browser, inviteUrl: string, name: string): Promise<Page> {
  const phone = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
  const admin = await phone.newPage();
  await virtualAuthenticator(admin);
  await registerWithInvite(admin, inviteUrl, name, 'en');
  await admin.getByRole('checkbox', { name: 'I have read and I agree' }).check();
  await admin.getByRole('button', { name: 'Continue' }).click();
  await expect(admin.getByRole('button', { name: 'Masjid Profile', exact: true })).toBeVisible();
  return admin;
}

test.describe('UPI changes are an owner’s (#161)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('editor sees who to ask; a request from a signed-out session is stopped and B8 says so', async ({
    page,
    browser,
    browserName,
    capture,
  }) => {
    test.skip(browserName !== 'chromium', 'the virtual authenticator is a Chromium DevTools feature');
    test.setTimeout(240_000);
    await resetRateLimits(page.request);
    await virtualAuthenticator(page);
    const token = await seedSuperAdminInvite(page.request, 'Test Owner', 'en');
    await registerWithInvite(page, `${ADMIN_URL}/invite#${token}`, 'Test Owner', 'en');
    const created = await page.request.post(`${ADMIN_URL}/api/super/masjids`, {
      headers: CSRF,
      data: {
        name: `Test Masjid Owners ${run}`,
        area: 'Test Area',
        city: 'Hyderabad',
        state: 'Telangana',
        address: 'Test address 1',
        lat: 17.385,
        lng: 78.4867,
      },
    });
    const { id: masjidId } = (await created.json()) as { id: string };
    const invite = async (displayName: string, role: 'owner' | 'editor') => {
      const response = await page.request.post(`${ADMIN_URL}/api/super/admins`, {
        headers: CSRF,
        data: { displayName, uiLocale: 'en', masjidId, role },
      });
      return ((await response.json()) as { inviteUrl: string }).inviteUrl;
    };
    const editor = await adminOn(browser, await invite('Test Editor', 'editor'), 'Test Editor');
    const owner = await adminOn(browser, await invite('Test Mutawalli', 'owner'), 'Test Mutawalli');
    try {
      // The editor: B8 has no "Set up UPI", /payment has no form; the API refuses anyway.
      await editor.goto(`${ADMIN_URL}/profile`);
      const b8 = editor.locator('[data-payment-admin]');
      await expect(b8.locator('[data-payment-owner-only]')).toHaveText(
        'Only an owner of the masjid can change the UPI details. Ask the owner, or the Super Admin.',
      );
      await expect(b8.getByRole('button', { name: 'Set up UPI' })).toHaveCount(0);
      expect(await axeViolations(editor)).toEqual([]);
      await capture('b8-payment-editor', { target: b8 });
      await editor.goto(`${ADMIN_URL}/payment`);
      await expect(editor.locator('[data-payment-owner-only]')).toBeVisible();
      await expect(editor.getByRole('textbox', { name: 'UPI ID' })).toHaveCount(0);
      const refused = await editor.request.post(`${ADMIN_URL}/api/admin/masjids/${masjidId}/payment/requests`, {
        headers: CSRF,
        data: { vpa: 'editor.try@okexample', payeeName: 'Test Committee' },
      });
      expect([refused.status(), ((await refused.json()) as { code: string }).code]).toEqual([
        403,
        'PAYMENT_OWNER_ONLY',
      ]);

      // The owner asks from this phone's session, then that session is signed out from elsewhere.
      const asked = await owner.request.post(`${ADMIN_URL}/api/admin/masjids/${masjidId}/payment/requests`, {
        headers: CSRF,
        data: { vpa: 'test.owner@okexample', payeeName: 'Test Masjid Committee' },
      });
      expect(asked.status()).toBe(201);
      const sessions = await owner.request.get(`${ADMIN_URL}/api/admin/auth/sessions`);
      const current = ((await sessions.json()) as { sessions: { id: string; current: boolean }[] }).sessions.find(
        (session) => session.current,
      );
      expect(
        (
          await owner.request.delete(`${ADMIN_URL}/api/admin/auth/sessions/${current?.id ?? ''}`, { headers: CSRF })
        ).status(),
      ).toBe(204);

      await editor.goto(`${ADMIN_URL}/profile`);
      await expect(b8.locator('[data-payment-request="rejected"]')).toContainText(
        'Stopped — the admin who asked no longer has access. An owner can ask again.',
      );
      await capture('b8-payment-stopped', { target: b8 });
    } finally {
      await editor.context().close();
      await owner.context().close();
    }
  });
});
