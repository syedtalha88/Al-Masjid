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

// PHASE_03 T3.8 — B7: an admin asks for dua for someone who is ill — a ready-made message switched to Hindi, a name
// with "Keep name private" on, a dua from the library, "Notify followers" — and a musalli whose app is in Hindi sees
// the request with "a brother or sister from our community", never the name. Then an inteqal with a janaza time and
// place, in its slate colours. Needs the runtime-test stack (the dev seed's verified placeholder duas). Fake texts only.

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
const NAME = 'Testperson Private';
/** Today in IST ("YYYY-MM-DD") — the date sheet opens on it. */
const todayIst = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

test.describe('B7 dua request creator (T3.8)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');
  test.use({ appLocale: 'hi' }); // the musalli page comes from this test's context

  test('illness with a private name → a Hindi musalli never sees the name; an inteqal with its janaza', async ({
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
        name: `Test Masjid Dua ${Date.now().toString(36)}`, // the stack database outlives a run
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
      const tile = admin.getByRole('button', { name: 'Dua Request', exact: true });
      await expect(tile).toBeVisible(); // the undertaking is accepted
      const timings = await admin.request.put(`${ADMIN_URL}/api/admin/masjids/${masjidId}/timings`, {
        headers: { ...CSRF, 'If-Match': '"0"' },
        data: TIMINGS,
      });
      expect(timings.status()).toBe(200);
      expect(
        (await page.request.post(`${ADMIN_URL}/api/super/masjids/${masjidId}/activate`, { headers: CSRF })).status(),
      ).toBe(204);
      // The screen on top (covered screens stay mounted, inert, under pushed ones).
      const top = admin.locator('section[data-screen]:not([inert])');

      // A musalli (app in Hindi) follows it and opens its Duas.
      const musalli = await page.context().newPage();
      await musalli.clock.install();
      await musalli.goto(APP_URL);
      await registerDevice(musalli);
      await followByCode(musalli, APP_URL, [followCode]);
      await musalli.goto(`${APP_URL}/masjid/${masjidId}/duas`);
      await expect(musalli.locator('html')).toHaveAttribute('lang', 'hi');

      // Step 1: three big cards; a tap goes on.
      await tile.click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/dua`);
      await expect(admin.getByText('Step 1 of 4')).toBeVisible();
      await admin.locator('[data-category="illness"]').click();

      // Step 2: a ready-made message (checked), switched to Hindi; a name kept private.
      await expect(admin).toHaveURL(`${ADMIN_URL}/dua/details`);
      await expect(admin.getByText('Step 2 of 4')).toBeVisible();
      const message = top.getByRole('textbox', { name: 'Message' });
      const english = await message.inputValue();
      expect(english).not.toBe('');
      await admin.getByRole('radio', { name: 'हिन्दी' }).click();
      await expect(message).not.toHaveValue(english);
      const hindi = await message.inputValue();
      const name = top.getByRole('textbox', { name: /^Name/ });
      await name.click();
      await name.fill(NAME);
      await expect(admin.getByRole('switch', { name: /^Keep name private/ })).toHaveAttribute('aria-checked', 'true');
      await admin.getByRole('button', { name: 'Next: Choose the dua' }).click();

      // Step 3: the illness duas of the library; a tap attaches one.
      await expect(admin).toHaveURL(`${ADMIN_URL}/dua/attach`);
      await expect(admin.getByText('Step 3 of 4')).toBeVisible();
      await top.locator('[data-entry]').first().click();

      // Step 4: the musalli card — "a brother or sister", never the name; publish with notifications on.
      await expect(admin).toHaveURL(`${ADMIN_URL}/dua/preview`);
      const frame = admin.locator('[data-preview-locale]');
      await expect(frame.getByText('For a brother or sister from our community')).toBeVisible();
      await expect(frame).not.toContainText(NAME);
      await admin.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(admin.getByRole('heading', { name: 'Published' })).toBeVisible();
      await admin.getByRole('button', { name: 'Done' }).click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/`);
      await expect(admin.getByText('Notifications today: 1 of 8 used')).toBeVisible();

      // One version poll later the Hindi musalli sees the request — with the Hindi message, without the name.
      await musalli.clock.fastForward('01:05');
      const request = musalli.getByRole('button').filter({ hasText: hindi });
      await expect(request).toBeVisible();
      await expect(request).toContainText('हमारी बिरादरी के एक भाई या बहन के लिए');
      await expect(musalli.locator('body')).not.toContainText(NAME);

      // An inteqal with a janaza today at 5 PM and a place, without notifying.
      await tile.click();
      await admin.locator('[data-category="inteqal"]').click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/dua/details`);
      await top.getByRole('button', { name: /^Date/ }).click();
      await admin.locator(`[data-date="${todayIst()}"]`).click();
      // The time sheet follows the date (5:00 PM is where its wheels start).
      await admin.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
      await expect(admin.getByRole('dialog')).toHaveCount(0);
      const place = top.getByRole('textbox', { name: /^Place/ });
      await place.click();
      await place.fill('Test place');
      await admin.getByRole('button', { name: 'Next: Choose the dua' }).click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/dua/attach`);
      await top.locator('[data-entry]').first().click();
      await expect(admin.locator('[data-preview-locale]')).toContainText('Test place');
      await admin.getByRole('switch', { name: 'Notify followers' }).click();
      await admin.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(admin.getByText('Followers will see it in the app.')).toBeVisible();
      await admin.getByRole('button', { name: 'Done' }).click();
      await musalli.clock.fastForward('01:05');
      const inteqal = musalli.getByRole('listitem').filter({ hasText: /जनाज़ा: .*Test place/ });
      await expect(inteqal).toBeVisible();
      // Acceptance: inteqal in the slate palette (its icon circle and tag — 06 §2, `DUA_TONE`).
      await expect(inteqal.locator('.bg-slate-bg')).not.toHaveCount(0);
    } finally {
      await phone.close();
    }
  });
});
