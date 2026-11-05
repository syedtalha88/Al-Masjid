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

// PHASE_03 T3.15 — B15 + A19: an admin types the masjid's own Ruqyah text (heading, Arabic, translation in Urdu, an
// instruction) through the editor with its live preview, adds a library dua, moves it up inside its heading; the musalli
// sees the Masjid Detail row and the list — masjid text "Added by <masjid>" with no source line, the library entry with
// its source; then the admin deletes the text and the musalli's next version shows only the library entry. Needs the
// runtime-test stack and the dev seed (`pnpm db:reset`). Placeholder texts only (10 §5).

const ARABIC = 'نص تجريبي للعرض فقط';
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

test.describe('B15 Ruqyah (T3.15)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('the admin adds text and a library entry → the musalli sees them; a deleted entry goes', async ({
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
    const name = `Test Masjid Ruqyah ${Date.now().toString(36)}`; // the stack database outlives a run
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
      const tile = admin.getByRole('button', { name: 'Ruqyah', exact: true });
      await expect(tile).toBeVisible();
      const timings = await admin.request.put(`${ADMIN_URL}/api/admin/masjids/${masjidId}/timings`, {
        headers: { ...CSRF, 'If-Match': '"0"' },
        data: TIMINGS,
      });
      expect(timings.status()).toBe(200);
      expect(
        (await page.request.post(`${ADMIN_URL}/api/super/masjids/${masjidId}/activate`, { headers: CSRF })).status(),
      ).toBe(204);
      const top = admin.locator('section[data-screen]:not([inert])');

      // B15: empty → Add → "Type text" under "Protection from Nazar" → the preview shows "Added by" → Save.
      await tile.click();
      await expect(top.getByRole('heading', { name: 'No Ruqyah entries yet' })).toBeVisible();
      await top.getByRole('button', { name: 'Add Ruqyah' }).click();
      await top.getByText('Type text', { exact: true }).click(); // radio cards are tapped by their text
      await top.getByText('Protection from Nazar', { exact: true }).click();
      await top.getByRole('textbox', { name: 'Arabic' }).fill(ARABIC);
      await top.getByRole('textbox', { name: 'Translation' }).fill('نمونہ ترجمہ — صرف جانچ کے لیے');
      await top
        .getByRole('radiogroup', { name: 'Language of the translation' })
        .getByRole('radio', { name: 'اردو' })
        .click();
      await top.getByRole('textbox', { name: /^Instruction/ }).fill('Sample instruction — test only.');
      const preview = top.getByRole('region', { name: 'Preview' });
      await expect(preview.locator('[data-ruqyah-added-by]')).toContainText(name);
      await expect(preview.locator('[data-ruqyah-source]')).toHaveCount(0);
      await admin.waitForTimeout(600); // the chips' selection and the preview's crossfade settle before axe reads colours
      expect(await axeViolations(admin)).toEqual([]);
      await top.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(admin.getByText('Ruqyah saved').first()).toBeVisible();
      await expect(top.locator('[data-ruqyah-row]')).toHaveCount(1);

      // A library dua (the seed's placeholder) under the same heading, then moved above the text.
      const duas = await admin.request.get(`${ADMIN_URL}/api/admin/masjids/${masjidId}/library?kind=dua`);
      const [dua] = ((await duas.json()) as { entries: { id: string }[] }).entries;
      const added = await admin.request.post(`${ADMIN_URL}/api/admin/masjids/${masjidId}/ruqyah`, {
        headers: CSRF,
        data: { category: 'nazar', source: 'library', libraryId: dua?.id },
      });
      expect(added.status()).toBe(201);
      await admin.reload();
      const rows = top.locator('[data-ruqyah-row]');
      await expect(rows).toHaveCount(2);
      const textId = (await rows.first().getAttribute('data-ruqyah-row')) ?? '';
      await rows.nth(1).getByRole('button', { name: 'Move up' }).click();
      await expect(rows.first()).not.toHaveAttribute('data-ruqyah-row', textId);
      expect(await axeViolations(admin)).toEqual([]);

      // The musalli: Masjid Detail row → A19, library entry first, then the masjid's own text.
      const musalli = await page.context().newPage();
      await musalli.clock.install();
      await musalli.goto(APP_URL);
      await registerDevice(musalli);
      await followByCode(musalli, APP_URL, [followCode]);
      await musalli.goto(`${APP_URL}/masjid/${masjidId}`);
      const view = musalli.locator('section[data-screen]:not([inert])');
      await view.getByRole('button', { name: /^Ruqyah/ }).click();
      const list = musalli.locator('[data-ruqyah-list]');
      const entries = list.locator('[data-ruqyah-entry]');
      await expect(entries).toHaveCount(2);
      await expect(entries.first()).toHaveAttribute('data-ruqyah-entry', 'library');
      await expect(entries.first().locator('[data-ruqyah-source]')).toContainText('Development fixture');
      const own = entries.nth(1);
      await expect(own.locator('[data-ruqyah-added-by]')).toContainText(name);
      await expect(own.locator('[data-ruqyah-source]')).toHaveCount(0);
      await expect(own.getByText('Sample instruction — test only.')).toBeVisible();
      expect(await axeViolations(musalli)).toEqual([]);

      // The admin deletes the text; one version poll later (60 s) the musalli sees only the library entry.
      await top.locator(`[data-ruqyah-row="${textId}"]`).getByRole('button', { name: 'Delete' }).click();
      await admin
        .getByRole('alertdialog', { name: 'Delete this entry?' })
        .getByRole('button', { name: 'Delete' })
        .click();
      await expect(admin.getByText('Entry deleted').first()).toBeVisible();
      await expect(rows).toHaveCount(1);
      await musalli.clock.fastForward('01:05');
      await expect(entries).toHaveCount(1);
      await expect(entries.first()).toHaveAttribute('data-ruqyah-entry', 'library');
    } finally {
      await phone.close();
    }
  });
});
