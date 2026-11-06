import { expect, test } from '@mc/config/playwright';
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

// PHASE_03 T3.7 — B6: an admin publishes today's hadith — "Choose another" in the search sheet, a short note, the
// preview in Urdu, "Notify followers" — and a musalli whose app is in Urdu sees it as the "Today's" hero of Hadith &
// Quran after one version poll (acceptance). A second hadith the same day shows the "already shared today" warning and
// still publishes. Needs the runtime-test stack (the dev seed's verified placeholder library). Fake texts only.

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
const NOTE = 'Test note from the masjid.';

test.describe('B6 hadith / ayah publisher (T3.7)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');
  test.use({ appLocale: 'ur' }); // the musalli page comes from this test's context

  test("today's hadith with a note → an Urdu musalli sees the Today's hero; a second one warns first", async ({
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
        name: `Test Masjid Daily ${Date.now().toString(36)}`, // the stack database outlives a run
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
      const tile = admin.getByRole('button', { name: 'Hadith / Ayah', exact: true });
      // The screen on top (covered screens stay mounted, inert, under pushed ones).
      const top = admin.locator('section[data-screen]:not([inert])');
      await expect(tile).toBeVisible(); // the undertaking is accepted
      const timings = await admin.request.put(`${ADMIN_URL}/api/admin/masjids/${masjidId}/timings`, {
        headers: { ...CSRF, 'If-Match': '"0"' },
        data: TIMINGS,
      });
      expect(timings.status()).toBe(200);
      expect(
        (await page.request.post(`${ADMIN_URL}/api/super/masjids/${masjidId}/activate`, { headers: CSRF })).status(),
      ).toBe(204);

      // A musalli (app in Urdu) follows it and opens its Hadith & Quran.
      const musalli = await page.context().newPage();
      await musalli.clock.install();
      await musalli.goto(APP_URL);
      await registerDevice(musalli);
      await followByCode(musalli, APP_URL, [followCode]);
      await musalli.goto(`${APP_URL}/masjid/${masjidId}/hadith`);
      await expect(musalli.locator('html')).toHaveAttribute('dir', 'rtl');

      // Step 1: today's suggestion; "Choose another" picks a different hadith in the search sheet.
      await tile.click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/daily`);
      await expect(admin.getByText('Step 1 of 3')).toBeVisible();
      await expect(admin.getByRole('radio', { name: 'Hadith' })).toBeChecked();
      const suggestion = admin.locator('[data-suggestion]');
      await expect(suggestion.getByText(/^DEV-SAMPLE-\d{3}$/)).toBeVisible();
      const suggested = (await suggestion.getByText(/^DEV-SAMPLE-\d{3}$/).textContent()) ?? '';
      await expect(top.locator('[data-published-today]')).toHaveCount(0);
      await admin.getByRole('button', { name: 'Choose another' }).click();
      const sheet = admin.getByRole('dialog', { name: 'Choose a hadith' });
      await expect(sheet.getByRole('radio', { name: 'All' })).toBeChecked(); // topic chips
      const other = sheet.locator('[data-entry]').filter({ hasNotText: suggested }).first();
      const chosen = (await other.getByText(/^DEV-SAMPLE-\d{3}$/).textContent()) ?? '';
      expect(chosen).not.toBe(suggested);
      await other.click();

      // Step 2: the chosen hadith and the optional note.
      await expect(admin).toHaveURL(`${ADMIN_URL}/daily/note`);
      await expect(admin.getByText('Step 2 of 3')).toBeVisible();
      await expect(top.getByText(chosen, { exact: true })).toBeVisible();
      const note = admin.getByRole('textbox', { name: /^Note from the masjid/ });
      // A tap first: while the search sheet closes the stack is inert, and `fill` would type into nothing.
      await note.click();
      await note.fill(NOTE);
      await expect(note).toHaveValue(NOTE);
      await admin.getByRole('button', { name: 'Next: Preview' }).click();

      // Step 3: the musalli hero card in each language; publish with notifications on.
      await expect(admin).toHaveURL(`${ADMIN_URL}/daily/preview`);
      const frame = admin.locator('[data-preview-locale]');
      await expect(frame.getByText('Today’s Hadith')).toBeVisible();
      await expect(frame.getByText(NOTE)).toBeVisible();
      await admin.getByRole('radio', { name: 'اردو' }).click();
      await expect(admin.locator('[data-preview-locale="ur"]').getByText('آج کی حدیث')).toBeVisible();
      await admin.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(admin.getByRole('heading', { name: 'Published' })).toBeVisible();
      await expect(admin.getByText(/people will be notified\.$/)).toBeVisible();
      await admin.getByRole('button', { name: 'Done' }).click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/`);
      await expect(admin.getByText('Notifications today: 1 of 8 used')).toBeVisible();

      // One version poll later the Urdu musalli sees it as "Today's" hero, with the note and the reference.
      await musalli.clock.fastForward('01:05');
      const hero = musalli.locator('li').filter({ hasText: chosen });
      await expect(hero.getByText('آج کی حدیث')).toBeVisible();
      await expect(hero.getByText(NOTE)).toBeVisible();
      await expect(hero.getByText(chosen, { exact: true })).toBeVisible();

      // A second hadith today: warned on step 1 and on the preview, published without notifying.
      await tile.click();
      await expect(top.locator('[data-published-today]')).toContainText('You already shared a hadith today.');
      // (The suggestion now skips the hadith just published — 60-day rule.)
      const next = (await suggestion.getByText(/^DEV-SAMPLE-\d{3}$/).textContent()) ?? '';
      expect(next).not.toBe(chosen);
      await admin.getByRole('button', { name: 'Use this' }).click();
      await admin.getByRole('button', { name: 'Next: Preview' }).click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/daily/preview`);
      await expect(top.locator('[data-published-today]')).toBeVisible();
      await admin.getByRole('switch', { name: 'Notify followers' }).click();
      await admin.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(admin.getByText('Followers will see it in the app.')).toBeVisible();
      await admin.getByRole('button', { name: 'Done' }).click();
      await musalli.clock.fastForward('01:05');
      await expect(musalli.getByText(next, { exact: true })).toBeVisible();
    } finally {
      await phone.close();
    }
  });
});
