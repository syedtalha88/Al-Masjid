import { APP_LOCALES, expect, seedOnboardedDevice, test } from '@mc/config/playwright';
import { devices, type Page } from '@playwright/test';

import { ADMIN_URL, APP_URL } from '../../playwright.config.ts';
import { awaitFollowsSynced, followByCode, registerDevice } from '../support/device.ts';
import {
  awaitNewestJob,
  awaitPushes,
  capturedPushes,
  deliverPush,
  fakeSubscription,
  shownNotifications,
  stubPushManager,
  subscribeDevice,
} from '../support/push.ts';
import {
  CSRF,
  HOOKS,
  label,
  registerWithInvite,
  resetRateLimits,
  seedSuperAdminInvite,
  virtualAuthenticator,
} from './helpers.ts';

// PHASE_04 T4.9 — push end to end, on the `push` project (full Chromium: the headless shell denies notifications).
// A Telugu sister turns notifications on in Settings → Notifications (the app's PushManager is stubbed with a fake FCM
// subscription — a headless browser cannot subscribe); a Hindi brother's phone subscribes through the API. The admin
// publishes a notifying notice → one notification job for everyone, 2 targeted, sent per language; the runtime-test
// worker captures each push (nothing leaves the machine); the sister's payload, delivered to her service worker through
// CDP, shows a Telugu notification that opens the notice. Then the ★ kill switch: a notice published while paused waits,
// and goes out after Resume. Also: the soft-ask and Settings → Notifications in every language (axe + screenshots).
// Needs the runtime-test stack (E2E_TEST_HOOKS=1). Fake texts only.

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

/** The service worker's payload (`@mc/shared/contracts/push` pushPayloadSchema — its fields are asserted below). */
interface Payload {
  readonly v: number;
  readonly t: string;
  readonly b: string;
  readonly u: string;
  readonly tag: string;
  readonly l: string;
}
const payloadOf = (text: string | undefined): Payload => JSON.parse(text ?? 'null') as Payload; // a captured push

const screen = (page: Page) => page.locator('section[data-screen]:not([inert])');

test.describe('push end to end (T4.9)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');
  test.use({ appLocale: 'te' });

  test('Settings → on; a notice reaches both phones in their language; the SW shows it; the kill switch holds it', async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    await resetRateLimits(page.request);

    // The Super Admin (this test's page, on the admin origin) creates a live masjid and its admin.
    await virtualAuthenticator(page);
    const token = await seedSuperAdminInvite(page.request, 'Test Owner', 'en');
    await registerWithInvite(page, `${ADMIN_URL}/invite#${token}`, 'Test Owner', 'en');
    // The stack database outlives a run: a run that died while paused must not hold this one's notifications.
    await page.goto(`${ADMIN_URL}/super/settings`);
    const pauseSwitch = page.getByRole('switch', { name: /^Pause all notifications/ });
    await expect(pauseSwitch).toBeVisible();
    if (await pauseSwitch.isChecked()) {
      await pauseSwitch.click();
      await page
        .getByRole('dialog', { name: label('en', 'super', 'stepUp.title') })
        .getByRole('button', { name: label('en', 'super', 'stepUp.confirm') })
        .click();
      await expect(pauseSwitch).not.toBeChecked();
    }
    const created = await page.request.post(`${ADMIN_URL}/api/super/masjids`, {
      headers: CSRF,
      data: {
        name: `Test Masjid Push ${Date.now().toString(36)}`, // the stack database outlives a run
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

    const adminPhone = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
    const brotherPhone = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
    let paused = false;
    try {
      const admin = await adminPhone.newPage();
      await virtualAuthenticator(admin);
      await registerWithInvite(admin, inviteUrl, 'Test Imam', 'en');
      await admin.getByRole('checkbox', { name: 'I have read and I agree' }).check();
      await admin.getByRole('button', { name: 'Continue' }).click();
      await expect(admin.getByRole('button', { name: 'Notice', exact: true })).toBeVisible();
      const timings = await admin.request.put(`${ADMIN_URL}/api/admin/masjids/${masjidId}/timings`, {
        headers: { ...CSRF, 'If-Match': '"0"' },
        data: TIMINGS,
      });
      expect(timings.status()).toBe(200);
      expect(
        (await page.request.post(`${ADMIN_URL}/api/super/masjids/${masjidId}/activate`, { headers: CSRF })).status(),
      ).toBe(204);

      // The sister (app in Telugu) follows the masjid and turns notifications on in Settings → Notifications.
      const sister = fakeSubscription();
      const sisterContext = page.context();
      await sisterContext.grantPermissions(['notifications'], { origin: APP_URL });
      await stubPushManager(sisterContext, sister);
      const musalli = await sisterContext.newPage();
      await musalli.goto(APP_URL);
      await registerDevice(musalli, { locale: 'te', audiencePref: 'sisters' });
      await followByCode(musalli, APP_URL, [followCode]);
      await musalli.goto(`${APP_URL}/settings/notifications`);
      const status = screen(musalli).locator('#push-heading').locator('..');
      await expect(status).toContainText(label('te', 'settings', 'push.status.off'));
      // Subscribing waits for the service worker; on a first visit it may still be precaching the app shell.
      await musalli.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });
      await screen(musalli)
        .getByRole('button', { name: label('te', 'settings', 'push.turnOn') })
        .click();
      await expect(status).toContainText(label('te', 'settings', 'push.status.on'));

      // The brother (Hindi) subscribes through the API. His phone is onboarded like the fixture's own context — without
      // the seed the app's first run writes its own device document over the stored credentials.
      await seedOnboardedDevice(brotherPhone, 'hi', 'brothers');
      const brotherPage = await brotherPhone.newPage();
      await brotherPage.goto(APP_URL);
      await registerDevice(brotherPage, { locale: 'hi', audiencePref: 'brothers' });
      await followByCode(brotherPage, APP_URL, [followCode]);
      const brother = fakeSubscription();
      await subscribeDevice(brotherPage, brother);
      await awaitFollowsSynced(musalli);
      await awaitFollowsSynced(brotherPage);

      // A notifying notice: one job for everyone, both phones targeted and sent; each push in its phone's language.
      const notice = await admin.request.post(`${ADMIN_URL}/api/admin/masjids/${masjidId}/items/announcement`, {
        headers: CSRF,
        data: {
          content: { kind: 'text', title: 'Test push title', body: 'Test push body', locale: 'en' },
          category: 'general',
          isImportant: false,
          notify: true,
        },
      });
      expect(notice.status()).toBe(201);
      const published = (await notice.json()) as {
        item: { publicId: string };
        notification: { queued: boolean; targeted: number } | null;
      };
      expect(published.notification).toMatchObject({ queued: true, targeted: 2 });
      const { publicId } = published.item;
      expect(await awaitNewestJob(admin.request, masjidId)).toMatchObject({
        audience: 'everyone',
        targeted: 2,
        sent: 2,
        failed: 0,
      });
      const [toSister] = await awaitPushes(page.request, sister.endpoint, 1);
      const [toBrother] = await awaitPushes(page.request, brother.endpoint, 1);
      const sisterPayload = payloadOf(toSister?.payload);
      const brotherPayload = payloadOf(toBrother?.payload);
      // Title = the masjid's name; body = the notice's title and text, as written (free text is not translated).
      const words = { t: expect.stringMatching(/^Test Masjid Push/), b: 'Test push title\nTest push body' };
      expect(sisterPayload).toMatchObject({ ...words, v: 1, l: 'te', u: `/items/${publicId}`, tag: publicId });
      expect(brotherPayload).toMatchObject({ ...words, v: 1, l: 'hi', u: `/items/${publicId}`, tag: publicId });
      expect(toSister).toMatchObject({ ttl: '86400', urgency: 'normal' }); // 01 §5.3 step 3
      expect(toSister?.topic).toBeUndefined(); // no item id for the push service (DECISIONS #142)

      // The push service hands the sister's push to her phone: her service worker shows it, in Telugu.
      await deliverPush(musalli, toSister?.payload ?? '');
      await expect.poll(async () => (await shownNotifications(musalli)).length).toBe(1);
      const [shown] = await shownNotifications(musalli);
      expect(shown).toMatchObject({
        title: sisterPayload.t,
        body: sisterPayload.b,
        tag: sisterPayload.tag,
        lang: 'te',
        dir: 'ltr',
      });
      expect(JSON.stringify(shown?.data)).toContain(`/items/${publicId}`);

      // ★ Kill switch (T4.7): paused, a notifying notice publishes but its notification waits.
      await page.goto(`${ADMIN_URL}/super/settings`);
      await page.getByRole('switch', { name: /^Pause all notifications/ }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Pause', exact: true }).click();
      paused = true; // before any assertion: the finally block must resume even when one fails
      const stepUpConfirm = page
        .getByRole('dialog', { name: label('en', 'super', 'stepUp.title') })
        .getByRole('button', { name: label('en', 'super', 'stepUp.confirm') });
      const pausedNote = page.getByRole('paragraph').filter({ hasText: 'Notifications paused' });
      // A step-up made moments ago (clearing a leftover pause above) is still fresh — then nothing is asked.
      await expect(stepUpConfirm.or(pausedNote)).toBeVisible();
      if (await stepUpConfirm.isVisible()) await stepUpConfirm.click();
      await expect(pausedNote).toBeVisible();
      const held = await admin.request.post(`${ADMIN_URL}/api/admin/masjids/${masjidId}/items/announcement`, {
        headers: CSRF,
        data: {
          content: { kind: 'text', title: 'Test held title', body: 'Test held body', locale: 'en' },
          category: 'general',
          isImportant: false,
          notify: true,
        },
      });
      expect(held.status()).toBe(201);
      await admin.goto(`${ADMIN_URL}/`);
      await expect(admin.getByText(label('en', 'admin', 'push.paused'))).toBeVisible();
      await page.waitForTimeout(5_000); // the worker had its chance to send
      expect(await capturedPushes(page.request, brother.endpoint)).toHaveLength(1);
      expect((await awaitNewestJob(admin.request, masjidId, 'pending')).sent).toBe(0);

      // Resume (no confirmation, the step-up is still fresh): the waiting notification goes out.
      await page.getByRole('switch', { name: /^Pause all notifications/ }).click();
      await expect(page.getByRole('paragraph').filter({ hasText: 'Notifications resumed' })).toBeVisible();
      paused = false;
      // A paused job looks at the switch again every minute (PAUSE_RECHECK_MS) — so allow a full recheck.
      const pushes = await awaitPushes(page.request, brother.endpoint, 2, 90_000);
      expect(pushes.at(-1)?.payload).toContain('Test held title');
      expect(await awaitNewestJob(admin.request, masjidId)).toMatchObject({ targeted: 2, sent: 2 });
    } finally {
      if (paused) {
        // Never leave the global switch on for the next spec.
        await page.request.post(`${ADMIN_URL}/api/super/settings/push-pause`, {
          headers: CSRF,
          data: { paused: false },
        });
      }
      await adminPhone.close();
      await brotherPhone.close();
    }
  });
});

for (const locale of APP_LOCALES) {
  test.describe(`notifications screens (${locale})`, () => {
    test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');
    test.use({ appLocale: locale });

    test('the soft-ask after the first follow, Settings → Notifications off and on: axe + screenshots', async ({
      page,
      context,
      expectAxeClean,
      capture,
    }) => {
      const t = (key: string) => label(locale, 'settings', key);
      await stubPushManager(context, fakeSubscription());
      await page.goto(APP_URL);
      await registerDevice(page, { locale });
      await followByCode(page, APP_URL, ['TESTA001']);

      // The soft-ask: once, a moment after the first follow, while the browser has not been asked.
      const ask = page.getByRole('dialog', { name: t('push.askTitle') });
      await expect(ask).toBeVisible();
      await page.waitForTimeout(600); // the sheet's spring settles before the shot
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
      await expectAxeClean();
      await capture('push-ask');
      await ask.getByRole('button', { name: t('push.askLater') }).click();
      await expect(ask).toHaveCount(0);

      await page.goto(`${APP_URL}/settings/notifications`);
      const status = screen(page).locator('#push-heading').locator('..');
      await expect(status).toContainText(t('push.status.off'));
      await expectAxeClean();
      await capture('a15-notifications-off');

      // Turning on asks the browser (granted here) and stores the subscription at the server.
      await context.grantPermissions(['notifications'], { origin: APP_URL });
      const stored = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/devices/me/push') && response.request().method() === 'PUT',
      );
      await screen(page)
        .getByRole('button', { name: t('push.turnOn') })
        .click();
      expect((await stored).status()).toBe(204);
      await expect(status).toContainText(t('push.status.on'));
      await expect(screen(page).getByRole('switch')).not.toHaveCount(0); // a switch per followed masjid
      await expectAxeClean();
      await capture('a15-notifications-on');
    });
  });
}
