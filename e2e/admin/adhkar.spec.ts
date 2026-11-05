import { axeViolations, expect, test } from '@mc/config/playwright';
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

// PHASE_03 T3.14 — B16 + A20: an admin turns "Adhkar after salah" on and picks dhikr from the verified library (the dev
// seed's placeholders); with the musalli's clock pinned, the Home card appears after the Dhuhr jamaat and is gone 30
// minutes later (acceptance); "See all" opens the list with its tap counter; "Hide" keeps the card away for that
// prayer. Needs the runtime-test stack and the dev seed (`pnpm db:reset`). Placeholder texts only (10 §5).

// The pinned clock needs the API's Date header removed (as in e2e/app/home.spec.ts); a service worker's requests would
// bypass page routes.
test.use({ serviceWorkers: 'block' });

const offset = (jamaatOffsetMin: number) => ({
  adhanMode: 'auto',
  adhanAdjustMin: 0,
  jamaatMode: 'offset',
  jamaatOffsetMin,
});
/** Dhuhr at a fixed 13:30 (after its adhan anywhere in India, all year); Jumu'ah at the same time on Fridays. */
const TIMINGS = {
  prayers: {
    fajr: offset(20),
    dhuhr: { adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'fixed', jamaatTime: '13:30' },
    asr: offset(15),
    maghrib: offset(5),
    isha: offset(15),
  },
  jumuah: [{ seq: 1, jamaatTime: '13:30' }],
  notify: false,
};
const CARD = /^Adhkar after salah · (Dhuhr|Jumu.ah)$/;

/** Today in India, "YYYY-MM-DD". */
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

async function pinClock(page: Page, isoIst: string) {
  await page.clock.install({ time: new Date(isoIst) });
  await page.route('**/api/v1/**', async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers['date'];
    await route.fulfill({ response, headers });
  });
}

test.describe('B16 adhkar after salah (T3.14)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('the admin picks dhikr → the musalli card after Dhuhr, gone 30 minutes later', async ({
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
    const created = await page.request.post(`${ADMIN_URL}/api/super/masjids`, {
      headers: CSRF,
      data: {
        name: `Test Masjid Adhkar ${Date.now().toString(36)}`, // the stack database outlives a run
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
      const tile = admin.getByRole('button', { name: 'Adhkar', exact: true });
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

      // B16: on, two dhikr from the library (the second moved first), the Home card preview, Save.
      await tile.click();
      await expect(top.getByRole('heading', { name: 'No adhkar chosen yet' })).toBeVisible();
      await top.getByRole('switch', { name: 'Show adhkar after salah' }).click();
      for (const index of [0, 1]) {
        await top.getByRole('button', { name: 'Add dhikr' }).click();
        const sheet = admin.getByRole('dialog', { name: 'Choose a dhikr' });
        await sheet.locator('[data-entry]').nth(index).click();
        await expect(sheet).toHaveCount(0);
      }
      await expect(top.locator('[data-dhikr]')).toHaveCount(2);
      await expect(top.getByText('2 of 30')).toBeVisible();
      await top.locator('[data-dhikr]').nth(1).getByRole('button', { name: 'Move up' }).click();
      await expect(top.locator('[data-adhkar-card]')).toBeVisible(); // the preview
      expect(await axeViolations(admin)).toEqual([]);
      await top.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(admin.getByText('Adhkar saved').first()).toBeVisible();
      const saved = await admin.request.get(`${ADMIN_URL}/api/admin/masjids/${masjidId}/adhkar`);
      expect(((await saved.json()) as { entries: unknown[]; enabled: boolean }).enabled).toBe(true);
    } finally {
      await phone.close();
    }

    // The musalli, clock pinned a minute after the Dhuhr (or Jumu'ah) jamaat.
    const musalli = await page.context().newPage();
    const today = istToday();
    await pinClock(musalli, `${today}T13:31:00+05:30`);
    await musalli.goto(APP_URL);
    await registerDevice(musalli);
    await followByCode(musalli, APP_URL, [followCode]);
    const card = musalli.locator('[data-adhkar-card]');
    await expect(card.getByRole('heading', { name: CARD })).toBeVisible();
    expect(await axeViolations(musalli)).toEqual([]);

    // "See all": the list in the admin's order, each with its repeat count and a tap counter.
    await card.getByRole('button', { name: 'See All' }).click();
    const list = musalli.locator('[data-adhkar-list]');
    await expect(list.locator('[data-dhikr]')).toHaveCount(2);
    const counter = list
      .locator('[data-dhikr]')
      .first()
      .getByRole('button', { name: /^Count: 0 of / });
    await counter.click();
    await expect(
      list
        .locator('[data-dhikr]')
        .first()
        .getByRole('button', { name: /^Count: 1 of / }),
    ).toBeVisible();
    expect(await axeViolations(musalli)).toEqual([]);
    await musalli.goBack();
    await expect(card).toBeVisible();

    // 30 minutes after the jamaat the card is gone (the Home clock re-renders each minute).
    await musalli.clock.fastForward('30:00');
    await expect(card).toHaveCount(0);

    // Back inside the window: "Hide" keeps it away for this prayer, also after a reload.
    await musalli.clock.setSystemTime(new Date(`${today}T13:40:00+05:30`));
    await musalli.clock.fastForward('01:00');
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Hide until the next salah' }).click();
    await expect(card).toHaveCount(0);
    await musalli.reload();
    await expect(musalli.getByRole('heading', { level: 1, name: 'Assalamu Alaikum' })).toBeVisible();
    await expect(card).toHaveCount(0);
  });
});
