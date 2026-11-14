import { expect, test } from '@mc/config/playwright';
import { devices } from '@playwright/test';

import { ADMIN_URL, APP_URL } from '../../playwright.config.ts';
import { followByCode, registerDevice } from '../support/device.ts';
import {
  CSRF,
  HOOKS,
  label,
  registerWithInvite,
  resetRateLimits,
  seedSuperAdminInvite,
  virtualAuthenticator,
} from './helpers.ts';

// PHASE_08 T8.2 — journey 11 (takedown): a masjid publishes a notice; a musalli reports it from the "…" menu; the
// Super Admin sees it in Reports (C5) with the post as musallis see it, removes it (★ step-up, reason category +
// private note: "Hidden for everyone now; preserved privately for 180 days"); the musalli's next open of the post says
// it is no longer available and the masjid's Announcements no longer list it; the masjid's My Posts shows "Removed by
// moderation" with the category and never the note; the removal is under "Removed" in Reports. Fake texts only.

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
const NOTE = 'Placeholder moderator note';

test.describe('journey 11 — report → remove (T8.2)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('reported post removed by the Super Admin: gone for musallis, the masjid sees the reason', async ({
    page,
    browser,
    browserName,
    capture,
    expectAxeClean,
  }) => {
    test.skip(browserName !== 'chromium', 'the virtual authenticator is a Chromium DevTools feature');
    test.setTimeout(240_000);
    await resetRateLimits(page.request);

    // The Super Admin creates the masjid and its admin.
    await virtualAuthenticator(page);
    const token = await seedSuperAdminInvite(page.request, 'Test Owner', 'en');
    await registerWithInvite(page, `${ADMIN_URL}/invite#${token}`, 'Test Owner', 'en');
    const masjidName = `Test Masjid Moderation ${Date.now().toString(36)}`; // the stack database outlives a run
    const created = await page.request.post(`${ADMIN_URL}/api/super/masjids`, {
      headers: CSRF,
      data: {
        name: masjidName,
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
      // The masjid's admin accepts the undertaking, saves the timings (activation needs them) and posts a notice.
      const admin = await phone.newPage();
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
      const notice = await admin.request.post(`${ADMIN_URL}/api/admin/masjids/${masjidId}/items/announcement`, {
        headers: CSRF,
        data: {
          content: { kind: 'text', title: 'Test reported notice', body: 'Test notice body', locale: 'en' },
          category: 'general',
          isImportant: false,
          notify: false,
        },
      });
      expect(notice.status()).toBe(201);
      const { publicId } = ((await notice.json()) as { item: { publicId: string } }).item;

      // A musalli follows the masjid, opens the notice and reports it.
      const musalli = await page.context().newPage();
      await musalli.goto(APP_URL);
      await registerDevice(musalli);
      // Also the seeded template notice of masjid Alpha (`no_water_time_range`): C5 must show its template text.
      await followByCode(musalli, APP_URL, [followCode, 'TESTA001']);
      const report = async (id: string, title: string) => {
        await musalli.goto(`${APP_URL}/items/${id}`);
        const detail = musalli.locator('section[data-screen]:not([inert])');
        await expect(detail.getByText(title).first()).toBeVisible();
        await detail.locator('[data-more-menu]').click();
        await musalli.locator('[data-report-open]').click();
        const sheet = musalli.getByRole('dialog', { name: 'Report this post' });
        await sheet.getByText('Misleading or false', { exact: true }).click();
        await sheet.getByRole('button', { name: 'Send report' }).click();
        await expect(musalli.getByRole('dialog', { name: 'Thank you' })).toBeVisible();
      };
      await report(publicId, 'Test reported notice');
      await report('seedA0000000', 'No water supply');

      // C5: the Super Admin finds it, with the post as musallis see it, and removes it.
      await page.goto(`${ADMIN_URL}/super/reports`);
      const card = page.locator('[data-report-target]').filter({ hasText: masjidName });
      await expect(card).toBeVisible();
      await expect(card.locator('[data-report-preview]')).toContainText('Test reported notice');
      // A template notice shows its template's text, in each language (07 C5 "identical to musalli rendering").
      const templated = page.locator('[data-report-target]').filter({ hasText: 'No water supply' });
      const preview = templated.locator('[data-report-preview]');
      await expect(preview).toContainText('Water will not be available from');
      await preview.getByRole('radio', { name: 'اردو' }).click();
      await expect(preview).toContainText('پانی دستیاب نہیں');
      await expect(card).toContainText('Misleading or false');
      await expectAxeClean();
      await capture('c5-reports');
      await card.getByRole('button', { name: 'Remove ★' }).click();
      const confirm = page.getByRole('alertdialog', { name: 'Remove this post?' });
      await expect(confirm).toContainText('Hidden for everyone now; preserved privately for 180 days.');
      await confirm.getByRole('button', { name: 'Reason the masjid will see' }).click();
      await page.getByRole('dialog', { name: 'Reason the masjid will see' }).getByText('Misleading or false').click();
      await confirm.getByRole('textbox', { name: /Private note/u }).fill(NOTE);
      await capture('c5-remove');
      await confirm.getByRole('button', { name: 'Remove ★' }).click();
      const stepUp = page
        .getByRole('dialog', { name: label('en', 'super', 'stepUp.title') })
        .getByRole('button', { name: label('en', 'super', 'stepUp.confirm') });
      const removed = page.getByText('Removed. It is hidden for everyone now.').first();
      await expect(stepUp.or(removed)).toBeVisible();
      if (await stepUp.isVisible()) await stepUp.click();
      await expect(removed).toBeVisible();
      await expect(page.locator('[data-report-target]').filter({ hasText: masjidName })).toHaveCount(0);

      // The musalli: after the app's next versions poll (fresh for 15 s, then on open / every 60 s) the post is gone
      // — the old link says so, and the list no longer has it.
      await expect
        .poll(
          async () => {
            await musalli.goto(`${APP_URL}/items/${publicId}`);
            // The cached copy may show for a moment until the app has checked the versions again.
            return musalli
              .getByText('This post is no longer available')
              .waitFor({ timeout: 10_000 })
              .then(
                () => true,
                () => false,
              );
          },
          { timeout: 90_000, intervals: [5_000] },
        )
        .toBe(true);
      await musalli.goto(`${APP_URL}/masjid/${masjidId}/announcements`);
      await expect(musalli.locator('section[data-screen]:not([inert])')).not.toContainText('Test reported notice');

      // The masjid: My Posts says why — the category, never the private note.
      await admin.goto(`${ADMIN_URL}/posts`);
      const post = admin.locator('[data-status="removed"]').first();
      await expect(post).toContainText('Removed by moderation');
      await expect(post).toContainText('Misleading or false');
      await expect(admin.locator('body')).not.toContainText(NOTE);

      // Reports → Removed lists it with its new status.
      await page.getByRole('radio', { name: 'Removed' }).click();
      await expect(
        page.locator('[data-report-target][data-item-status="removed"]').filter({ hasText: masjidName }),
      ).toBeVisible();
    } finally {
      await phone.close();
    }
  });
});
