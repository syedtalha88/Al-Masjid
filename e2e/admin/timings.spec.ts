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

// PHASE_03 T3.2 — the B4 prayer timings editor. Journey 6 (10 §3): an admin sets the timings with taps, the masjid goes
// live, a musalli follows it; the admin changes Isha and the musalli's timetable shows the new time after one version
// poll (the musalli page clock is controlled). Then: a save over another admin's change gets the "changed by someone
// else" dialog, and an invalid combination blocks saving. Needs the runtime-test stack. Fake names only.

/** "HH:mm" → a pattern for the English "8:30 PM" (the formatter puts a narrow no-break space before AM/PM). */
const shown = (hhmm: string): RegExp => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return new RegExp(`${String(hour)}:${String(m).padStart(2, '0')}\\s${h < 12 ? 'AM' : 'PM'}`);
};

/** Today in India ("YYYY-MM-DD"). */
const istToday = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

async function ishaJamaat(admin: Page, masjidId: string): Promise<string> {
  const response = await admin.request.get(
    `${ADMIN_URL}/api/admin/masjids/${masjidId}/timings/preview?date=${istToday()}`,
  );
  expect(response.status()).toBe(200);
  const day = (await response.json()) as { prayers: { prayer: string; jamaat: string | null }[] };
  const isha = day.prayers.find((p) => p.prayer === 'isha')?.jamaat;
  expect(isha).toBeTruthy();
  return isha ?? '';
}

const card = (admin: Page, prayer: string) => admin.locator(`[data-prayer="${prayer}"]`);

async function saveTimings(admin: Page): Promise<void> {
  await admin.getByRole('button', { name: 'Save timings' }).click();
  const confirm = admin.getByRole('dialog', { name: 'Save these timings?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(admin.getByRole('heading', { name: 'Saved' })).toBeVisible();
  await admin.getByRole('button', { name: 'Done' }).click();
}

test.describe('B4 prayer timings editor (T3.2)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('journey 6: taps only → live → the musalli sees a changed jamaat after one version poll; conflicts and invalid times', async ({
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
        name: `Test Masjid Timings ${Date.now().toString(36)}`, // the stack database outlives a run
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

      // B3 → B4 through the tile. A new masjid starts with Maghrib 5 minutes after adhan; the rest is unset.
      await admin.getByRole('button', { name: 'Prayer Times' }).click();
      await expect(admin).toHaveURL(/\/timings$/);
      await expect(admin.getByText('Set all five jamaat times so your masjid can go live.')).toBeVisible();
      for (const prayer of ['fajr', 'dhuhr', 'asr', 'isha']) {
        await card(admin, prayer)
          .getByRole('button', { name: /^Jamaat/ })
          .click();
        const sheet = admin.getByRole('dialog');
        await expect(sheet.getByText('10 minutes after adhan')).toBeVisible();
        await sheet.getByRole('button', { name: 'Done' }).click();
        await expect(admin.getByRole('dialog')).toHaveCount(0);
        await expect(card(admin, prayer).getByText('10 min after adhan')).toBeVisible();
      }
      await expect(admin.getByText('Set all five jamaat times so your masjid can go live.')).toHaveCount(0);
      // Everything is new: "Notify followers" starts on.
      await expect(admin.getByRole('switch', { name: 'Notify followers' })).toHaveAttribute('aria-checked', 'true');
      await saveTimings(admin);
      await expect(admin).toHaveURL(`${ADMIN_URL}/`);

      // Now the Super Admin can activate it.
      const activated = await page.request.post(`${ADMIN_URL}/api/super/masjids/${masjidId}/activate`, {
        headers: CSRF,
      });
      expect(activated.status()).toBe(204);

      // A musalli follows it and opens its timetable.
      // The test's own context: its device starts onboarded (the `appDevice` fixture); the admin origin is another one.
      const musalli = await page.context().newPage();
      await musalli.clock.install();
      await musalli.goto(APP_URL);
      await registerDevice(musalli);
      await followByCode(musalli, APP_URL, [followCode]);
      await musalli.goto(`${APP_URL}/masjid/${masjidId}/timings`);
      const isha = musalli.getByRole('row').filter({ hasText: 'Isha' });
      await expect(isha).toContainText(shown(await ishaJamaat(admin, masjidId)));

      // The admin moves Isha's jamaat 5 minutes later.
      await admin.getByRole('button', { name: 'Prayer Times' }).click();
      await card(admin, 'isha')
        .getByRole('button', { name: /^Jamaat/ })
        .click();
      const sheet = admin.getByRole('dialog', { name: 'Isha jamaat' });
      for (let i = 0; i < 5; i += 1) await sheet.getByRole('button', { name: '1 minute more' }).click();
      await expect(sheet.getByText('15 minutes after adhan')).toBeVisible();
      await sheet.getByRole('button', { name: 'Done' }).click();
      await admin.getByRole('button', { name: 'Save timings' }).click();
      await expect(admin.getByRole('dialog', { name: 'Save these timings?' })).toContainText(/Isha Jamaat: .+ → .+/);
      await admin.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
      await admin.getByRole('button', { name: 'Done' }).click();
      const later = await ishaJamaat(admin, masjidId);

      // One version poll later (60 s on the musalli's clock) the timetable shows it.
      await musalli.clock.fastForward('01:05');
      await expect(isha).toContainText(shown(later));

      // Someone else saves while this admin is editing → "changed by someone else", then the latest loads.
      await admin.getByRole('button', { name: 'Prayer Times' }).click();
      await card(admin, 'asr')
        .getByRole('button', { name: /^Jamaat/ })
        .click();
      await admin.getByRole('dialog').getByRole('button', { name: '1 minute more' }).click();
      await admin.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
      const current = (await (
        await admin.request.get(`${ADMIN_URL}/api/admin/masjids/${masjidId}/timings`)
      ).json()) as {
        rev: number;
        timings: { prayers: Record<string, object>; jumuah: object[] };
      };
      const other = await admin.request.put(`${ADMIN_URL}/api/admin/masjids/${masjidId}/timings`, {
        headers: { ...CSRF, 'If-Match': `"${String(current.rev)}"` },
        data: {
          prayers: {
            ...current.timings.prayers,
            isha: { adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'offset', jamaatOffsetMin: 20 },
          },
          jumuah: current.timings.jumuah,
          notify: false,
        },
      });
      expect(other.status()).toBe(200);
      await admin.getByRole('button', { name: 'Save timings' }).click();
      await admin
        .getByRole('dialog', { name: 'Save these timings?' })
        .getByRole('button', { name: 'Save', exact: true })
        .click();
      const conflict = admin.getByRole('dialog', { name: 'Someone else changed the timings' });
      await expect(conflict).toBeVisible();
      await conflict.getByRole('button', { name: 'Load the latest' }).click();
      await expect(card(admin, 'isha').getByText('20 min after adhan')).toBeVisible();
      await expect(card(admin, 'asr').getByText('10 min after adhan')).toBeVisible(); // this admin's edit was dropped

      // Isha's adhan set before Maghrib: the card says so and Save is blocked.
      await card(admin, 'isha')
        .getByRole('button', { name: /^Adhan/ })
        .click();
      const adhan = admin.getByRole('dialog', { name: 'Isha adhan' });
      await adhan.getByRole('radio', { name: 'Set time' }).click();
      const hour = adhan.getByRole('spinbutton', { name: 'Hour' });
      await hour.focus();
      for (let i = 0; i < 4; i += 1) await hour.press('ArrowUp');
      await adhan.getByRole('button', { name: 'Done' }).click();
      await expect(card(admin, 'isha').getByText('Isha is before Maghrib')).toBeVisible();
      await expect(admin.getByRole('button', { name: 'Save timings' })).toBeDisabled();
    } finally {
      await phone.close();
    }
  });
});
