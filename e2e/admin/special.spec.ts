import { expect, test } from '@mc/config/playwright';
import { devices, type Page } from '@playwright/test';

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

// PHASE_03 T3.3 — B11 Special Dates & Ramadan. An admin adds an Eid day for tomorrow with taps (type card, date,
// one time with a name), notifying followers; a musalli following the masjid sees it in the Special Dates tab and the
// Eid card on Home after one version poll (the musalli page clock is controlled). The admin deletes it — it is gone
// after the next poll — and turns Ramadan mode on: the musalli Home shows the Ramadan card. Invalid input is blocked
// before it reaches the server. Needs the runtime-test stack. Fake names only.

const DAY_MS = 24 * 60 * 60 * 1000;
/** A day in India ("YYYY-MM-DD"), `offset` days from today. */
const istDay = (offset = 0) => new Date(Date.now() + 5.5 * 60 * 60 * 1000 + offset * DAY_MS).toISOString().slice(0, 10);

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

/** Taps `date` in the open date sheet (it opens on the current month; the day may be in the next one). */
async function pickDate(admin: Page, date: string): Promise<void> {
  await expect(admin.getByRole('dialog')).toBeVisible();
  const day = admin.locator(`[data-date="${date}"]`);
  if ((await day.count()) === 0) await admin.getByRole('button', { name: 'Next month' }).click();
  await day.click();
  await expect(admin.getByRole('dialog')).toHaveCount(0);
}

/** One version poll on the musalli's clock (60 s, 01 §5.2). */
const poll = (musalli: Page) => musalli.clock.fastForward('01:05');

test.describe('B11 special dates & Ramadan (T3.3)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('admin adds an Eid day → musalli sees it after one poll; delete; Ramadan mode → Ramadan card', async ({
    page,
    browser,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'the virtual authenticator is a Chromium DevTools feature');
    test.setTimeout(240_000);
    await resetRateLimits(page.request);

    // The Super Admin creates the masjid and its admin.
    await virtualAuthenticator(page);
    const token = await seedSuperAdminInvite(page.request, 'Test Owner', 'en');
    await registerWithInvite(page, `${ADMIN_URL}/invite#${token}`, 'Test Owner', 'en');
    const created = await page.request.post(`${ADMIN_URL}/api/super/masjids`, {
      headers: CSRF,
      data: {
        name: `Test Masjid Special ${Date.now().toString(36)}`, // the stack database outlives a run
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
      const tile = admin.getByRole('button', { name: 'Special Dates & Ramadan', exact: true });
      await expect(tile).toBeVisible(); // the undertaking is accepted
      // Timings (B4 has its own journey) through the API, then the masjid goes live.
      const timings = await admin.request.put(`${ADMIN_URL}/api/admin/masjids/${masjidId}/timings`, {
        headers: { ...CSRF, 'If-Match': '"0"' },
        data: TIMINGS,
      });
      expect(timings.status()).toBe(200);
      expect(
        (await page.request.post(`${ADMIN_URL}/api/super/masjids/${masjidId}/activate`, { headers: CSRF })).status(),
      ).toBe(204);

      // A musalli follows it; the Special Dates tab is empty.
      const musalli = await page.context().newPage(); // its device starts onboarded (the test's own context)
      await musalli.clock.install();
      await musalli.goto(APP_URL);
      await registerDevice(musalli);
      await followByCode(musalli, APP_URL, [followCode]);
      await musalli.goto(`${APP_URL}/masjid/${masjidId}/timings`);
      await musalli.getByRole('tab', { name: 'Special Dates' }).click();
      await expect(musalli.getByText('No special dates coming up.')).toBeVisible();

      // B3 → B11 through the tile: no special dates yet.
      await tile.click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/special`);
      await expect(admin.getByText('No special dates yet')).toBeVisible();
      await admin.getByRole('button', { name: 'Add special date' }).click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/special/new`);
      const save = admin.getByRole('button', { name: 'Save', exact: true });
      await expect(save).toBeDisabled(); // nothing chosen yet

      // Taps only: the day, its date, one time; a name for the time is the only typing (optional).
      await admin.getByText('Eid ul-Fitr', { exact: true }).click(); // the card (its radio is visually hidden)
      await expect(admin.getByRole('radio', { name: 'Eid ul-Fitr' })).toBeChecked();
      await admin.getByRole('button', { name: /^Date/ }).click();
      await pickDate(admin, istDay(1));
      await admin.getByRole('button', { name: 'Add a time' }).click();
      const wheel = admin.getByRole('dialog', { name: 'Time 1' });
      await expect(wheel).toBeVisible();
      await wheel.getByRole('button', { name: 'Done' }).click(); // Eid starts the wheel at 7:30 AM
      await expect(admin.getByRole('dialog')).toHaveCount(0);
      await admin.getByRole('textbox', { name: /^Name for time 1/ }).fill('Test slot one');

      // A second time equal to the first is caught before saving.
      await admin.getByRole('button', { name: 'Add a time' }).click();
      await admin.getByRole('dialog', { name: 'Time 2' }).getByRole('button', { name: 'Done' }).click();
      await expect(admin.getByText('Two times are the same.')).toBeVisible();
      await expect(save).toBeDisabled();
      await admin.getByRole('button', { name: 'Remove time 2' }).click();
      await expect(admin.getByText('Two times are the same.')).toHaveCount(0);

      // Tomorrow: "Notify followers" starts on.
      await expect(admin.getByRole('switch', { name: 'Notify followers' })).toHaveAttribute('aria-checked', 'true');
      // The preview is the musalli card.
      await admin.getByRole('button', { name: 'Preview' }).click();
      await expect(admin.locator('[data-preview-locale]').getByText('Eid ul-Fitr')).toBeVisible();
      await admin.keyboard.press('Escape');
      await expect(admin.getByRole('dialog')).toHaveCount(0);
      await save.click();
      await expect(admin.getByRole('heading', { name: 'Saved' })).toBeVisible();
      await expect(admin.getByText('Your followers will be notified.')).toBeVisible();
      await admin.getByRole('button', { name: 'Done' }).click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/special`);
      const row = admin.locator('[data-special]');
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('Eid ul-Fitr');

      // One version poll later the musalli's Special Dates tab shows it — and Home's Eid card.
      await poll(musalli);
      await expect(musalli.getByText('Eid ul-Fitr', { exact: true })).toBeVisible();
      await expect(musalli.getByText(/7:30\sAM · Test slot one/)).toBeVisible();
      await musalli.goto(APP_URL);
      await expect(musalli.getByText('Eid ul-Fitr Salah')).toBeVisible();

      // The admin deletes it; after the next poll it is gone for the musalli.
      await row.click();
      await expect(admin).toHaveURL(/\/special\/[0-9a-f-]{36}$/);
      await admin.getByRole('button', { name: 'Delete' }).click();
      const confirm = admin.getByRole('alertdialog', { name: 'Delete this special date?' });
      await confirm.getByRole('button', { name: 'Delete' }).click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/special`);
      await expect(admin.getByText('No special dates yet')).toBeVisible();
      await poll(musalli);
      await expect(musalli.getByText('Eid ul-Fitr Salah')).toHaveCount(0);

      // Ramadan mode from today for 30 days, Sehri 5 minutes earlier: the musalli Home shows the Ramadan card.
      const ramadan = admin.locator('[data-section="ramadan"]');
      await ramadan.getByRole('switch', { name: 'Ramadan mode' }).click();
      await ramadan.getByRole('button', { name: /^First day/ }).click();
      await pickDate(admin, istDay(0));
      await ramadan.getByRole('button', { name: /^Last day/ }).click();
      await pickDate(admin, istDay(29));
      for (let i = 0; i < 5; i += 1) await ramadan.getByRole('button', { name: 'Sehri: 1 minute more' }).click();
      await expect(ramadan.getByText('5 minutes')).toBeVisible();
      await ramadan.getByRole('button', { name: 'Save Ramadan settings' }).click();
      await expect(admin.getByRole('paragraph').filter({ hasText: 'Ramadan settings saved' })).toBeVisible();
      await poll(musalli);
      await expect(musalli.getByText('Sehri ends')).toBeVisible();
    } finally {
      await phone.close();
    }
  });
});
