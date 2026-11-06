import { axeViolations, expect, test } from '@mc/config/playwright';
import { devices, type Page } from '@playwright/test';

import { ADMIN_URL, APP_URL } from '../../playwright.config.ts';
import { followByCode, registerDevice } from '../support/device.ts';
import { shotFor, switchAppLanguage } from '../support/locale.ts';
import {
  CSRF,
  HOOKS,
  registerWithInvite,
  resetRateLimits,
  seedSuperAdminInvite,
  virtualAuthenticator,
} from './helpers.ts';

// PHASE_03 T3.17 — B18 + A22: the admin's "Blood Camp" tile opens B5 at step 2 with the `blood_donation_camp` template
// (date, hours on two wheels, place, contact number), the preview shows the camp card, Publish with notifications on by
// default. A musalli whose clock is pinned to that morning sees the card on Home and Masjid Detail — "Contact on
// WhatsApp" opens wa.me, the card never prints the number — and the notice detail has the number in its text plus the
// same button; after the camp's last hour the cards are gone. Needs the runtime-test stack. Fake data only.

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

/** Today in India, "YYYY-MM-DD". */
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

/** Pins the page's clock; the API's Date header is dropped so the app does not correct the pinned time. */
async function pinClock(page: Page, iso: string) {
  await page.clock.install({ time: new Date(iso) });
  // The context, not the page: the app's service worker fetches API responses too, and only the context's routes
  // see those (Chromium) — a Date header through the worker would set the app back to the real time.
  await page.context().route('**/api/v1/**', async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers['date'];
    await route.fulfill({ response, headers });
  });
}

test.describe('B18 blood donation camp (T3.17)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('the tile publishes a camp → the musalli’s card until the camp is over', async ({
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
    const name = `Test Masjid Camp ${Date.now().toString(36)}`; // the stack database outlives a run
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
      const tile = admin.getByRole('button', { name: 'Blood Camp', exact: true });
      await expect(tile).toBeVisible();
      const timings = await admin.request.put(`${ADMIN_URL}/api/admin/masjids/${masjidId}/timings`, {
        headers: { ...CSRF, 'If-Match': '"0"' },
        data: TIMINGS,
      });
      expect(timings.status()).toBe(200);
      expect(
        (await page.request.post(`${ADMIN_URL}/api/super/masjids/${masjidId}/activate`, { headers: CSRF })).status(),
      ).toBe(204);

      // B18: the tile → step 2 of the camp template (an event), straight away.
      await tile.click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/notice/fill`);
      await expect(admin.getByText('Step 2 of 3')).toBeVisible();
      await expect(admin.getByRole('radio', { name: 'Event' })).toBeChecked();
      // Today, 10:00 AM → 2:00 PM (the wheels start there), a place and the organiser's number.
      await admin.locator('[data-param="date"]').getByRole('button').click();
      await admin.getByRole('dialog').locator('[aria-current="date"]').click();
      await expect(admin.getByRole('dialog')).toHaveCount(0);
      await admin.getByRole('button', { name: /^From/ }).click();
      await admin.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
      await expect(admin.getByRole('dialog')).toHaveCount(0);
      await admin.getByRole('button', { name: /^To/ }).click();
      await admin.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
      await expect(admin.getByRole('dialog')).toHaveCount(0);
      await admin.getByRole('textbox', { name: 'Place' }).fill('Test Hall');
      await admin.getByRole('textbox', { name: /^Contact number/ }).fill('+91 00000 00007');

      // Step 3: the notice and the camp card; notifications on by default.
      await admin.getByRole('button', { name: 'Next: Preview' }).click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/notice/preview`);
      const frame = admin.locator('[data-preview-locale]');
      await expect(frame.locator('[data-blood-camp]')).toContainText('Test Hall');
      await expect(
        frame.getByText(/Blood donation camp on .+ at Test Hall\. To register, contact .+00007/),
      ).toBeVisible();
      await expect(admin.getByRole('switch', { name: 'Notify followers' })).toHaveAttribute('aria-checked', 'true');
      await admin.waitForTimeout(600); // the preview's crossfade settles before axe reads colours
      expect(await axeViolations(admin)).toEqual([]);
      await admin.getByRole('switch', { name: 'Notify followers' }).click(); // no push service locally
      await admin.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(admin.getByRole('heading', { name: 'Published' })).toBeVisible();
    } finally {
      await phone.close();
    }

    // The musalli on the morning of the camp: the card on Home.
    const musalli = await page.context().newPage();
    const today = istToday();
    await pinClock(musalli, `${today}T09:00:00+05:30`);
    await musalli.context().route('https://wa.me/**', (route) => route.fulfill({ status: 200, body: 'ok' }));
    await musalli.goto(APP_URL);
    await registerDevice(musalli);
    await followByCode(musalli, APP_URL, [followCode]);
    const top = musalli.locator('section[data-screen]:not([inert])');
    const card = top.locator('[data-blood-camp]');
    await expect(card).toContainText('Blood donation camp');
    await expect(card).toContainText('Test Hall');
    await expect(card).toContainText(name);
    expect(await card.textContent()).not.toMatch(/00007/);
    expect(await axeViolations(musalli)).toEqual([]);
    const popup = musalli.waitForEvent('popup');
    await card.getByRole('button', { name: 'Contact on WhatsApp' }).click();
    expect(new URL((await popup).url()).pathname).toBe('/910000000007');
    await musalli.bringToFront();

    // The card opens the notice: the number in its text, and the same WhatsApp button.
    await card.getByRole('button', { name: /Blood donation camp/ }).click();
    await expect(musalli).toHaveURL(/\/items\//);
    await expect(top.getByText(/To register, contact .*\+91 00000 00007/)).toBeVisible();
    await expect(top.getByRole('button', { name: 'Contact on WhatsApp' })).toBeVisible();

    // Masjid Detail shows it too.
    await musalli.goto(`${APP_URL}/masjid/${masjidId}`);
    await expect(top.locator('[data-blood-camp]')).toContainText('Test Hall');

    // A minute after 2:00 PM the camp is over: no card on Masjid Detail or Home.
    await musalli.clock.fastForward('05:01:00');
    await expect(top.locator('[data-blood-camp]')).toHaveCount(0);
    await musalli.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Home/ }).click();
    await expect(musalli.getByRole('heading', { level: 1, name: 'Assalamu Alaikum' })).toBeVisible();
    await expect(musalli.locator('[data-blood-camp]')).toHaveCount(0);

    // A22 in every language (PHASE_03 exit: screenshots in 4 locales), each in its own page with the
    // morning clock again (the language change reloads the app).
    for (const [from, to] of [
      ['en', 'en'],
      ['en', 'hi'],
      ['hi', 'ur'],
      ['ur', 'te'],
    ] as const) {
      const view = await musalli.context().newPage();
      try {
        await pinClock(view, `${today}T09:00:00+05:30`);
        if (from !== to) await switchAppLanguage(view, from, to);
        await view.goto(APP_URL);
        const camp = view.locator('section[data-screen]:not([inert]) [data-blood-camp]');
        await expect(camp).toContainText('Test Hall');
        await expect(view.locator('html')).toHaveAttribute('dir', to === 'ur' ? 'rtl' : 'ltr');
        expect(await axeViolations(view), `axe a22 ${to}`).toEqual([]);
        await shotFor(view, to, 'a22-blood-camp');
      } finally {
        await view.close();
      }
    }
  });
});
