import { expect, test } from '@mc/config/playwright';
import { devices } from '@playwright/test';

import { ADMIN_URL } from '../../playwright.config.ts';
import {
  CSRF,
  HOOKS,
  registerWithInvite,
  resetRateLimits,
  seedSuperAdminInvite,
  virtualAuthenticator,
} from './helpers.ts';

// PHASE_03 T3.10 — B13 Masjid Profile: the names in four scripts (view), a new photo after the ownership tick, the
// Hijri adjustment with today's Hijri date, and "Request a change" reaching the Super Admin dashboard. (The field
// allow-list acceptance is covered by the db and api integration tests.) Needs the runtime-test stack. Fake texts only.

/** A 1×1 PNG: enough for the server's pipeline (decoded, re-encoded, stored). */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const NOTE = 'Test note: please add the Urdu name.';

test.describe('B13 Masjid Profile (T3.10)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('photo, Hijri adjustment, a change request on the Super Admin dashboard', async ({
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
    const name = `Test Masjid Profile ${Date.now().toString(36)}`; // the stack database outlives a run
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
    const { id: masjidId } = (await created.json()) as { id: string };
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
      const tile = admin.getByRole('button', { name: 'Masjid Profile', exact: true });
      await expect(tile).toBeVisible(); // the undertaking is accepted
      const top = admin.locator('section[data-screen]:not([inert])');

      // The names (view) and no photo yet.
      await tile.click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/profile`);
      await expect(top.locator('[data-names]')).toContainText(name);
      await expect(top.getByText('No photo yet')).toBeVisible();

      // A photo: the picker opens only after the ownership tick.
      const change = top.getByRole('button', { name: 'Change photo' });
      await expect(change).toBeDisabled();
      await top.getByText('This masjid owns this photo or may share it').click();
      const chooser = admin.waitForEvent('filechooser');
      await change.click();
      await (await chooser).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PIXEL });
      await expect(admin.getByText('Photo changed').first()).toBeVisible();
      await expect(top.getByText('No photo yet')).toHaveCount(0);

      // The Hijri adjustment: +1 day moves today's Hijri date; then back to the app's date.
      const hijri = top.locator('[data-hijri]');
      const before = (await hijri.getByText(/^Today: /).textContent()) ?? '';
      await expect(hijri.getByText('Following the app’s date.')).toBeVisible();
      await hijri.getByRole('radio', { name: '+1' }).click();
      await expect(hijri.getByText(/^Today: /)).not.toHaveText(before);
      await expect(hijri.getByRole('button', { name: 'Follow the app’s date' })).toBeVisible();
      await hijri.getByRole('button', { name: 'Follow the app’s date' }).click();
      await expect(hijri.getByText(/^Today: /)).toHaveText(before);
      await expect(hijri.getByText('Following the app’s date.')).toBeVisible();

      // "Request a change" → a note for the Masjid Connect team.
      await top.getByRole('button', { name: 'Request a change' }).click();
      const sheet = admin.getByRole('dialog', { name: 'What should be changed?' });
      const note = sheet.getByRole('textbox', { name: 'Your note' });
      await note.click();
      await note.fill(NOTE);
      await sheet.getByRole('button', { name: 'Send' }).click();
      await expect(admin.getByText('Sent to the Masjid Connect team').first()).toBeVisible();
    } finally {
      await phone.close();
    }

    // The Super Admin sees it on the dashboard; the row opens the masjid.
    await page.goto(`${ADMIN_URL}/super`);
    const requests = page.locator('[data-change-requests]');
    await expect(requests).toContainText(NOTE);
    await requests.getByRole('button', { name: new RegExp(name) }).click();
    await expect(page).toHaveURL(`${ADMIN_URL}/super/masjids/${masjidId}`);
  });
});
