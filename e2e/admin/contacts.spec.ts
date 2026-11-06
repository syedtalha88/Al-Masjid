import { axeViolations, expect, test } from '@mc/config/playwright';
import { devices } from '@playwright/test';

import { ADMIN_URL, APP_URL } from '../../playwright.config.ts';
import { followByCode, registerDevice } from '../support/device.ts';
import {
  CSRF,
  HOOKS,
  registerWithInvite,
  resetRateLimits,
  seedSuperAdminInvite,
  virtualAuthenticator,
} from './helpers.ts';

// PHASE_03 T3.16 — B17 + A21: an admin adds an Ilm contact for sisters in Masjid Profile — Save stays off until the
// consent box is ticked — and a brothers device shows no "Ask the masjid" row; once the masjid also lists a brother, the
// brothers device shows the row with only him (one version poll later). A new number clears the tick; removing a
// contact asks first. Needs the runtime-test stack (`pnpm stack:up:test`). Fake names and numbers only.

const TIMINGS = {
  prayers: Object.fromEntries(
    ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].map((name) => [
      name,
      { adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'offset', jamaatOffsetMin: 15 },
    ]),
  ),
  jumuah: [{ seq: 1, jamaatTime: '13:30' }],
  notify: false,
};

test.describe('B17 Ilm contacts (T3.16)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('consent is required; a sisters’ contact never shows on a brothers device', async ({
    page,
    browser,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'the virtual authenticator is a Chromium DevTools feature');
    test.setTimeout(180_000);
    await resetRateLimits(page.request);

    await virtualAuthenticator(page);
    const token = await seedSuperAdminInvite(page.request, 'Test Owner', 'en');
    await registerWithInvite(page, `${ADMIN_URL}/invite#${token}`, 'Test Owner', 'en');
    const name = `Test Masjid Ilm ${Date.now().toString(36)}`; // the stack database outlives a run
    const created = await page.request.post(`${ADMIN_URL}/api/super/masjids`, {
      headers: CSRF,
      data: {
        name,
        area: 'Test Area',
        city: 'Hyderabad',
        state: 'Telangana',
        address: 'Test address 1',
        lat: 17.385,
        lng: 78.4867,
      },
    });
    expect(created.status()).toBe(201);
    const { id: masjidId, followCode } = (await created.json()) as { id: string; followCode: string };
    const invited = await page.request.post(`${ADMIN_URL}/api/super/admins`, {
      headers: CSRF,
      data: { displayName: 'Test Imam', uiLocale: 'en', masjidId, role: 'owner' },
    });
    const { inviteUrl } = (await invited.json()) as { inviteUrl: string };

    const phone = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
    try {
      const admin = await phone.newPage();
      await virtualAuthenticator(admin);
      await registerWithInvite(admin, inviteUrl, 'Test Imam', 'en');
      await admin.getByRole('checkbox', { name: 'I have read and I agree' }).check();
      await admin.getByRole('button', { name: 'Continue' }).click();
      await expect(admin.getByText(name).first()).toBeVisible();
      const timings = await admin.request.put(`${ADMIN_URL}/api/admin/masjids/${masjidId}/timings`, {
        headers: { ...CSRF, 'If-Match': '"0"' },
        data: TIMINGS,
      });
      expect(timings.status()).toBe(200);
      expect(
        (await page.request.post(`${ADMIN_URL}/api/super/masjids/${masjidId}/activate`, { headers: CSRF })).status(),
      ).toBe(204);
      const top = admin.locator('section[data-screen]:not([inert])');

      // B17 in B13: Add → name, number, For sisters → Save stays off until the consent tick → Save.
      await admin.goto(`${ADMIN_URL}/profile`);
      await top.getByRole('button', { name: 'Add contact' }).click();
      await top.getByRole('textbox', { name: 'Name' }).fill('Test Contact Sister');
      const number = top.getByRole('textbox', { name: 'WhatsApp number' });
      await expect(number).toHaveValue('+91 ');
      await number.fill('+91 00000 00003');
      await top.getByText('For sisters', { exact: true }).click(); // radio cards are tapped by their text
      const save = top.getByRole('button', { name: 'Save', exact: true });
      await expect(save).toBeDisabled();
      await expect(top.locator('[data-contact-missing]')).toContainText('the tick that they agreed');
      await top.getByRole('checkbox', { name: /This person agreed to be listed/ }).check();
      await expect(top.getByRole('region', { name: 'What musallis see' }).locator('[data-ilm-contact]')).toContainText(
        'Test Contact Sister',
      );
      await admin.waitForTimeout(600); // the preview's crossfade settles before axe reads colours
      expect(await axeViolations(admin)).toEqual([]);
      await expect(save).toBeEnabled();
      await save.click();
      await expect(admin.getByText('Contact saved').first()).toBeVisible();
      const rows = top.locator('[data-contact-row]');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('For sisters');

      // A brothers device (the fixture's default): no "Ask the masjid" row.
      const musalli = await page.context().newPage();
      await musalli.clock.install();
      await musalli.goto(APP_URL);
      await registerDevice(musalli);
      await followByCode(musalli, APP_URL, [followCode]);
      await musalli.goto(`${APP_URL}/masjid/${masjidId}`);
      const view = musalli.locator('section[data-screen]:not([inert])');
      await expect(view.getByRole('heading', { level: 1, name })).toBeVisible();
      await musalli.waitForLoadState('networkidle');
      await expect(view.getByRole('button', { name: 'Ask the masjid' })).toHaveCount(0);

      // The masjid also lists a brother: one version poll (60 s) later the row shows — with him only.
      const brother = await admin.request.post(`${ADMIN_URL}/api/admin/masjids/${masjidId}/contacts`, {
        headers: CSRF,
        data: { name: 'Test Contact Brother', whatsapp: '+910000000004', audience: 'brothers', consentConfirmed: true },
      });
      expect(brother.status()).toBe(201);
      await musalli.clock.fastForward('01:05');
      await view.getByRole('button', { name: 'Ask the masjid' }).click();
      const list = musalli.locator('[data-ilm-list]');
      await expect(list.locator('[data-ilm-contact]')).toHaveCount(1);
      await expect(list.getByText('Test Contact Brother')).toBeVisible();
      await expect(list.getByText('Test Contact Sister')).toHaveCount(0);
      expect(await list.textContent()).not.toMatch(/0000000|\+91/);
      expect(await axeViolations(musalli)).toEqual([]);

      // Editing: a new number clears the tick; removing asks first.
      await admin.reload();
      await rows.filter({ hasText: 'Test Contact Sister' }).getByRole('button').click();
      const consent = top.getByRole('checkbox', { name: /This person agreed to be listed/ });
      await expect(consent).toBeChecked();
      await top.getByRole('textbox', { name: 'WhatsApp number' }).fill('+91 00000 00005');
      await expect(consent).not.toBeChecked();
      await expect(save).toBeDisabled();
      await top.getByRole('button', { name: 'Remove contact' }).click();
      await admin
        .getByRole('alertdialog', { name: 'Remove this contact?' })
        .getByRole('button', { name: 'Remove contact' })
        .click();
      await expect(admin.getByText('Contact removed').first()).toBeVisible();
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('For brothers');
    } finally {
      await phone.close();
    }
  });
});
