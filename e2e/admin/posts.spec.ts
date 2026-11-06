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

// PHASE_03 T3.9 — B12 My Posts: "View in My Posts" after a publish (F50); Edit within 24 h reopens the notice flow,
// "Save changes" → the musalli sees the new title marked "Edited"; Delete (confirm) → **the musalli no longer sees the
// post after the next version poll** (acceptance). Needs the runtime-test stack. Fake texts only.

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
const TITLE = 'Test post title';
const EDITED = 'Test edited title';

test.describe('B12 My Posts (T3.9)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('publish → View in My Posts → edit (musalli sees "Edited") → delete (gone after one poll)', async ({
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
        name: `Test Masjid Posts ${Date.now().toString(36)}`, // the stack database outlives a run
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
      const noticeTile = admin.getByRole('button', { name: 'Notice', exact: true });
      await expect(noticeTile).toBeVisible(); // the undertaking is accepted
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

      // A musalli follows it and opens its Announcements.
      const musalli = await page.context().newPage();
      await musalli.clock.install();
      await musalli.goto(APP_URL);
      await registerDevice(musalli);
      await followByCode(musalli, APP_URL, [followCode]);
      await musalli.goto(`${APP_URL}/masjid/${masjidId}/announcements`);

      // Publish an own-text notice; "View in My Posts" (F50) opens My Posts with it.
      await noticeTile.click();
      await admin.getByRole('button', { name: 'Write your own' }).click();
      const title = top.getByRole('textbox', { name: 'Title' });
      await title.click();
      await title.fill(TITLE);
      await top.getByRole('textbox', { name: 'Message' }).fill('Test post body');
      await admin.getByRole('button', { name: 'Next: Preview' }).click();
      await admin.getByRole('switch', { name: 'Notify followers' }).click();
      await admin.getByRole('button', { name: 'Publish', exact: true }).click();
      await admin.getByRole('button', { name: 'View in My Posts' }).click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/posts`);
      const post = top.locator('[data-post]').filter({ hasText: TITLE });
      await expect(post).toHaveAttribute('data-status', 'published');
      await expect(post.getByText(/^You can change it until/)).toBeVisible();
      await musalli.clock.fastForward('01:05');
      await expect(musalli.getByRole('button', { name: TITLE })).toBeVisible();

      // Edit: the notice flow, prefilled; "Save changes" (no notify switch); back in My Posts.
      await post.getByRole('button', { name: 'Edit' }).click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/notice/fill`);
      const editTitle = top.getByRole('textbox', { name: 'Title' });
      await expect(editTitle).toHaveValue(TITLE);
      await editTitle.fill(EDITED);
      await admin.getByRole('button', { name: 'Next: Preview' }).click();
      await expect(admin.getByRole('switch', { name: 'Notify followers' })).toHaveCount(0);
      await admin.getByRole('button', { name: 'Save changes' }).click();
      await expect(admin.getByRole('heading', { name: 'Saved' })).toBeVisible();
      await admin.getByRole('button', { name: 'Done' }).click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/posts`);
      const edited = top.locator('[data-post]').filter({ hasText: EDITED });
      await expect(edited).toBeVisible();

      // One poll later the musalli sees the new title; its detail says "Edited".
      await musalli.clock.fastForward('01:05');
      const card = musalli.getByRole('button', { name: EDITED });
      await expect(card).toBeVisible();
      await card.click();
      await expect(musalli.getByText(/· Edited$/)).toBeVisible();
      await musalli.goBack();

      // Delete (confirm) → "Deleted" in My Posts; one poll later the musalli no longer sees it (acceptance).
      await edited.getByRole('button', { name: 'Delete' }).click();
      await admin.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
      await expect(admin.getByText('Post deleted').first()).toBeVisible(); // the toast (and its live-region copy)
      await expect(top.locator('[data-post]').filter({ hasText: EDITED })).toHaveAttribute('data-status', 'deleted');
      await musalli.clock.fastForward('01:05');
      await expect(musalli.getByRole('button', { name: EDITED })).toHaveCount(0);
      await expect(musalli.getByText(EDITED)).toHaveCount(0);
    } finally {
      await phone.close();
    }
  });
});
