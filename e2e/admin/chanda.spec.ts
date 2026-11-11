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

// PHASE_05 T5.5 — weekly chanda end to end: the admin (B9, from the Home tile) enters this week's total with a note while
// chanda is hidden — a follower sees no "Weekly Chanda" row and A11 says there is nothing; "Show chanda to followers"
// on → the row appears and A11 shows "This week" with the total, the note and the 8-week chart (tap a bar → its
// amount); off again → gone. Fake amounts only.

const run = Date.now().toString(36); // the stack database outlives a run
const offset = (jamaatOffsetMin: number) => ({
  adhanMode: 'auto',
  adhanAdjustMin: 0,
  jamaatMode: 'offset',
  jamaatOffsetMin,
});
const TIMINGS = {
  prayers: { fajr: offset(20), dhuhr: offset(15), asr: offset(15), maghrib: offset(5), isha: offset(15) },
  jumuah: [{ seq: 1, jamaatTime: '13:30' }],
  notify: false,
};

test.describe('weekly chanda (T5.5)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('entered while hidden → not public; shown → A11 with the total and chart; hidden again → gone', async ({
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
        name: `Test Masjid Chanda ${run}`,
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
      data: { displayName: 'Test Treasurer', uiLocale: 'en', masjidId, role: 'owner' },
    });
    const { inviteUrl } = (await invited.json()) as { inviteUrl: string };

    const phone = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
    try {
      const admin = await phone.newPage();
      await virtualAuthenticator(admin);
      await registerWithInvite(admin, inviteUrl, 'Test Treasurer', 'en');
      await admin.getByRole('checkbox', { name: 'I have read and I agree' }).check();
      await admin.getByRole('button', { name: 'Continue' }).click();
      const tile = admin.getByRole('button', { name: 'Chanda', exact: true });
      await expect(tile).toBeVisible();
      expect(
        (
          await admin.request.put(`${ADMIN_URL}/api/admin/masjids/${masjidId}/timings`, {
            headers: { ...CSRF, 'If-Match': '"0"' },
            data: TIMINGS,
          })
        ).status(),
      ).toBe(200);
      expect(
        (await page.request.post(`${ADMIN_URL}/api/super/masjids/${masjidId}/activate`, { headers: CSRF })).status(),
      ).toBe(204);

      // B9: this week's total and a note, while chanda is hidden (notify is off and cannot be turned on).
      await tile.click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/chanda`);
      const b9 = admin.locator('[data-chanda]');
      await expect(b9.getByRole('switch', { name: /^Show chanda to followers/ })).toHaveAttribute(
        'aria-checked',
        'false',
      );
      await expect(b9.getByRole('heading', { name: 'This week' })).toBeVisible();
      await expect(b9.getByRole('switch', { name: /^Notify followers/ })).toBeDisabled();
      const pad = b9.getByRole('group', { name: 'Total collected' });
      for (const key of ['1', '8', '5', '0', '0']) await pad.getByRole('button', { name: key, exact: true }).click();
      await expect(pad.locator('output')).toHaveText('₹18,500');
      await b9.getByRole('textbox', { name: /^Note/ }).fill('Test: thanks to everyone');
      await b9.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(admin.locator('p', { hasText: /^Saved$/ })).toBeVisible();
      await expect(b9.locator('[data-chanda-row]')).toHaveCount(1);
      await expect(b9.getByRole('button', { name: 'Save changes' })).toBeVisible(); // the week is saved now
      expect(await axeViolations(admin)).toEqual([]);
      await capture('b9-chanda', { target: b9 });

      // A follower: no row, nothing on A11.
      const musalli = await page.context().newPage();
      await musalli.goto(APP_URL);
      await registerDevice(musalli);
      await followByCode(musalli, APP_URL, [followCode]);
      const top = musalli.locator('section[data-screen]:not([inert])');
      await musalli.goto(`${APP_URL}/masjid/${masjidId}`);
      await expect(top.getByRole('heading', { level: 1, name: `Test Masjid Chanda ${run}` })).toBeVisible({
        timeout: 15_000,
      });
      await expect(top.getByRole('button', { name: /Weekly Chanda/ })).toHaveCount(0);
      await musalli.goto(`${APP_URL}/masjid/${masjidId}/chanda`);
      await expect(top.getByText('No chanda reported yet')).toBeVisible();

      // Shown: the row, "This week", the total and note, 8 bars; a tap shows the amount.
      await b9.getByRole('switch', { name: /^Show chanda to followers/ }).click();
      await expect(admin.locator('p', { hasText: 'Chanda is now shown to followers' })).toBeVisible();
      await expect(async () => {
        await musalli.goto(`${APP_URL}/masjid/${masjidId}`);
        await expect(top.getByRole('button', { name: /Weekly Chanda/ })).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 30_000 });
      await top.getByRole('button', { name: /Weekly Chanda/ }).click();
      await expect(top.getByRole('heading', { level: 1, name: 'Weekly Chanda' })).toBeVisible();
      await expect(top.getByText('This week')).toBeVisible();
      await expect(top.locator('[data-chanda-week] .sr-only')).toHaveText('₹18,500');
      await expect(top.getByText('Test: thanks to everyone')).toBeVisible();
      const chart = top.getByRole('group', { name: 'Chanda of the last 8 weeks' });
      await expect(chart.getByRole('button')).toHaveCount(8);
      await chart.getByRole('button').last().click();
      await expect(top.locator('[data-chanda-chart] p')).toContainText('₹18,500');
      await expect(top.getByText('Reported by masjid admin.')).toBeVisible();
      expect(await axeViolations(musalli)).toEqual([]);
      await capture('a11-chanda', { target: top });

      // Hidden again: the row is gone.
      await b9.getByRole('switch', { name: /^Show chanda to followers/ }).click();
      await expect(admin.locator('p', { hasText: 'Chanda is now hidden from followers' })).toBeVisible();
      await expect(async () => {
        await musalli.goto(`${APP_URL}/masjid/${masjidId}`);
        await expect(top.getByRole('heading', { level: 1, name: `Test Masjid Chanda ${run}` })).toBeVisible({
          timeout: 5000,
        });
        await expect(top.getByRole('button', { name: /Weekly Chanda/ })).toHaveCount(0);
      }).toPass({ timeout: 30_000 });
    } finally {
      await phone.close();
    }
  });
});
