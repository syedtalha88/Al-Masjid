import { expect, test } from '@mc/config/playwright';
import { devices } from '@playwright/test';

import { ADMIN_URL, APP_URL } from '../../playwright.config.ts';
import { followByCode, registerDevice } from '../support/device.ts';
import {
  awaitNewestJob,
  awaitPushes,
  capturedPushes,
  fakeSubscription,
  notificationJobs,
  subscribeDevice,
} from '../support/push.ts';
import {
  CSRF,
  HOOKS,
  registerWithInvite,
  resetRateLimits,
  seedSuperAdminInvite,
  virtualAuthenticator,
} from './helpers.ts';

// PHASE_03 T3.6 — journey 7: an admin publishes a template notice ("No water supply", hours picked on two wheels —
// no typing) with a photo and "Notify followers"; a musalli whose app is in Telugu sees it in Telugu after one version
// poll. Then a "Write your own" notice in Telugu, published without notifying. Missing params are named before the
// preview. Needs the runtime-test stack (the dev seed's templates are active there). Fake texts only.

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
/** A 1×1 PNG: enough for the server's pipeline (decoded, re-encoded, stored). */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('B5 notice creator (T3.6)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');
  test.use({ appLocale: 'te' }); // the musalli page comes from this test's context

  test('journey 7: template notice with taps → a Telugu musalli sees it in Telugu; own text too', async ({
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
        name: `Test Masjid Notice ${Date.now().toString(36)}`, // the stack database outlives a run
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
      const tile = admin.getByRole('button', { name: 'Notice', exact: true });
      await expect(tile).toBeVisible(); // the undertaking is accepted
      const timings = await admin.request.put(`${ADMIN_URL}/api/admin/masjids/${masjidId}/timings`, {
        headers: { ...CSRF, 'If-Match': '"0"' },
        data: TIMINGS,
      });
      expect(timings.status()).toBe(200);
      expect(
        (await page.request.post(`${ADMIN_URL}/api/super/masjids/${masjidId}/activate`, { headers: CSRF })).status(),
      ).toBe(204);

      // A musalli (app in Telugu) follows it and opens its Announcements.
      const musalli = await page.context().newPage();
      await musalli.clock.install();
      await musalli.goto(APP_URL);
      await registerDevice(musalli, { locale: 'te' });
      await followByCode(musalli, APP_URL, [followCode]);
      const subscription = fakeSubscription(); // notifications on for this phone (T4.9)
      await subscribeDevice(musalli, subscription);
      await musalli.goto(`${APP_URL}/masjid/${masjidId}/announcements`);
      await expect(musalli.locator('html')).toHaveAttribute('lang', 'te');

      // Step 1: the template tiles in the admin's language.
      await tile.click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/notice`);
      await expect(admin.getByText('Step 1 of 3')).toBeVisible();
      await admin.getByRole('button', { name: 'No water supply' }).click();

      // Step 2: the hours are missing — named, not sent.
      await expect(admin).toHaveURL(`${ADMIN_URL}/notice/fill`);
      await expect(admin.getByText('Step 2 of 3')).toBeVisible();
      await expect(admin.getByRole('radio', { name: 'Facilities' })).toBeChecked(); // preset by the template
      await expect(admin.getByRole('switch', { name: /^Important/ })).toHaveAttribute('aria-checked', 'true');
      const next = admin.getByRole('button', { name: 'Next: Preview' });
      await next.click();
      await expect(admin.getByText('Please set: Hours')).toBeInViewport(); // scrolled to, not off screen
      await expect(admin).toHaveURL(`${ADMIN_URL}/notice/fill`);
      // Two wheels, no typing: 10:00 AM → 2:00 PM (the wheels start there).
      await admin.getByRole('button', { name: /^From/ }).click();
      await admin.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
      await expect(admin.getByRole('dialog')).toHaveCount(0);
      await admin.getByRole('button', { name: /^To/ }).click();
      await admin.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
      await expect(admin.getByRole('dialog')).toHaveCount(0);
      await expect(admin.getByRole('button', { name: /^From.*10:00/ })).toBeVisible();
      await expect(admin.getByRole('button', { name: /^To.*2:00/ })).toBeVisible();

      // A photo: the picker opens only after the ownership tick.
      const addPhoto = admin.getByRole('button', { name: 'Add a photo' });
      await expect(addPhoto).toBeDisabled();
      await admin.getByText('This masjid owns this photo or may share it').click();
      const chooser = admin.waitForEvent('filechooser');
      await addPhoto.click();
      await (await chooser).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PIXEL });
      await expect(admin.getByRole('button', { name: 'Remove photo' })).toBeVisible();

      // Step 3: the musalli card in each language; publish with notifications on.
      await next.click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/notice/preview`);
      const frame = admin.locator('[data-preview-locale]');
      await expect(frame.getByText('No water supply')).toBeVisible();
      await expect(
        frame.getByText(
          /Water will not be available from [\u2066\u2069]?10:00\sAM[\u2066\u2069]? to [\u2066\u2069]?2:00\sPM/,
        ),
      ).toBeVisible();
      await admin.getByRole('radio', { name: 'తెలుగు' }).click();
      await expect(admin.locator('[data-preview-locale="te"]').getByText('నీటి సరఫరా నిలిపివేత')).toBeVisible();
      await expect(admin.getByText('Followers see the photo when they open the notice.')).toBeVisible();
      await expect(admin.getByRole('switch', { name: 'Notify followers' })).toHaveAttribute('aria-checked', 'true');
      await admin.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(admin.getByRole('heading', { name: 'Published' })).toBeVisible();
      await expect(admin.getByText(/people will be notified\.$/)).toBeVisible();
      await admin.getByRole('button', { name: 'Done' }).click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/`);
      await expect(admin.getByText('Notifications today: 1 of 8 used')).toBeVisible();
      // T4.9: one notification for everyone, the follower with notifications on targeted and sent — in Telugu.
      expect(await awaitNewestJob(admin.request, masjidId)).toMatchObject({
        audience: 'everyone',
        targeted: 1,
        sent: 1,
      });
      const [pushed] = await awaitPushes(admin.request, subscription.endpoint, 1);
      expect(JSON.parse(pushed?.payload ?? 'null')).toMatchObject({ l: 'te', b: /^నీటి సరఫరా నిలిపివేత\n/ });
      expect(pushed?.urgency).toBe('high'); // an important notice

      // One version poll later the Telugu musalli sees it in Telugu.
      await musalli.clock.fastForward('01:05');
      // (Home under the Announcements screen lists it too — the card is the button named by its title.)
      const card = musalli.getByRole('button', { name: 'నీటి సరఫరా నిలిపివేత' });
      await expect(card).toBeVisible();
      await expect(card).toContainText(/నుండి .* వరకు నీరు అందుబాటులో ఉండదు/);

      // "Write your own" in Telugu, without notifying.
      await tile.click();
      await admin.getByRole('button', { name: 'Write your own' }).click();
      await admin.getByRole('radio', { name: 'తెలుగు' }).click();
      await admin.getByRole('textbox', { name: 'Title' }).fill('పరీక్ష శీర్షిక');
      await admin.getByRole('textbox', { name: 'Message' }).fill('పరీక్ష సందేశం');
      await next.click();
      await expect(admin.locator('[data-preview-locale]').getByText('పరీక్ష శీర్షిక')).toBeVisible();
      await admin.getByRole('switch', { name: 'Notify followers' }).click();
      await admin.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(admin.getByText('Followers will see it in the app.')).toBeVisible();
      await admin.getByRole('button', { name: 'Done' }).click();
      await musalli.clock.fastForward('01:05');
      await expect(musalli.getByRole('button', { name: /^పరీక్ష శీర్షిక/ })).toBeVisible();
      // Not notified: no second notification, nothing more sent to the phone.
      expect(await notificationJobs(admin.request, masjidId)).toHaveLength(1);
      expect(await capturedPushes(admin.request, subscription.endpoint)).toHaveLength(1);
    } finally {
      await phone.close();
    }
  });
});
