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

// F54 (PHASE_03 T3.13 follow-up) — B14 recording through Chromium's fake capture device (a beeping tone; no permission
// prompt): the admin records about 3 seconds in the hadith note step, the browser measures it, the server stores it; the
// musalli plays it inside the hadith card (A8). Needs the runtime-test stack. Fake texts only.

// Launch flags force their own worker, so they live at the top of this file.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

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
const TITLE = 'Test recorded voice note';

test.describe('B14 recording through the microphone (F54)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');
  test('record → a hadith with the voice note → the musalli plays it in the A8 card', async ({
    page,
    browser,
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'the fake capture device and the virtual authenticator are Chromium features',
    );
    test.setTimeout(180_000);
    await resetRateLimits(page.request);

    await virtualAuthenticator(page);
    const token = await seedSuperAdminInvite(page.request, 'Test Owner', 'en');
    await registerWithInvite(page, `${ADMIN_URL}/invite#${token}`, 'Test Owner', 'en');
    const created = await page.request.post(`${ADMIN_URL}/api/super/masjids`, {
      headers: CSRF,
      data: {
        name: `Test Masjid Recording ${Date.now().toString(36)}`,
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

    const phone = await browser.newContext({
      ...devices['Pixel 7'],
      ignoreHTTPSErrors: true,
      permissions: ['microphone'],
    });
    try {
      const admin = await phone.newPage();
      await virtualAuthenticator(admin);
      await registerWithInvite(admin, inviteUrl, 'Test Imam', 'en');
      await admin.getByRole('checkbox', { name: 'I have read and I agree' }).check();
      await admin.getByRole('button', { name: 'Continue' }).click();
      const tile = admin.getByRole('button', { name: 'Hadith / Ayah', exact: true });
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

      // Today's hadith, then the note step: the ownership tick, Record, about 3 seconds, Stop, "Use this".
      await tile.click();
      await admin.getByRole('button', { name: 'Use this' }).click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/daily/note`);
      const voice = top.locator('[data-voice-field]');
      await voice.getByText('This masjid recorded this or may share it').click();
      await voice.getByRole('button', { name: 'Record', exact: true }).click();
      await expect(voice.getByRole('button', { name: 'Stop' })).toBeVisible();
      await admin.waitForTimeout(3_000);
      await voice.getByRole('button', { name: 'Stop' }).click();
      await voice.getByRole('button', { name: 'Use this' }).click();
      await expect(voice.getByRole('button', { name: 'Remove voice note' })).toBeVisible();
      await expect(voice.locator('[data-voice-note]')).toHaveAttribute('aria-label', /^Voice message, [23] seconds$/);
      await top.getByRole('textbox', { name: 'Title of the voice note' }).fill(TITLE);
      await admin.getByRole('button', { name: 'Next: Preview' }).click();
      await admin.getByRole('switch', { name: 'Notify followers' }).click();
      await admin.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(admin.getByRole('heading', { name: 'Published' })).toBeVisible();
    } finally {
      await phone.close();
    }

    // The musalli: the recording plays inside the hadith card (A8 hero, F54).
    const musalli = await page.context().newPage();
    await musalli.goto(APP_URL);
    await registerDevice(musalli);
    await followByCode(musalli, APP_URL, [followCode]);
    await musalli.goto(`${APP_URL}/masjid/${masjidId}/hadith`);
    const note = musalli.locator('[data-voice-note]').first();
    await expect(note).toBeVisible();
    await note.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(note.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect(note.getByText('Available when online')).toHaveCount(0);
  });
});
