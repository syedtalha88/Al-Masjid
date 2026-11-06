import { expect, test } from '@mc/config/playwright';
import { devices, type Locator, type Page } from '@playwright/test';

import { ADMIN_URL } from '../../playwright.config.ts';
import {
  CSRF,
  HOOKS,
  registerWithInvite,
  resetRateLimits,
  seedSuperAdminInvite,
  virtualAuthenticator,
} from './helpers.ts';

// PHASE_03 T3.12 — the 5-task usability script (owner guide Phase 03), measured: each task starts on Admin Home and
// counts every tap until the change is saved or published (typing is not needed in any of them). Acceptance: ≤ 6 taps
// each. The counts are attached to the report ("tap-counts") and copied into docs/reports/PHASE_03_REPORT.md.
//   1. Set Maghrib's jamaat to 10 minutes after the adhan.
//   2. Publish "No water 10–2".
//   3. Publish today's hadith.
//   4. Create an illness dua request with the name kept private.
//   5. Delete a post.

const TAP_BUDGET = 6;
const TIMINGS = {
  prayers: Object.fromEntries(
    ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].map((name) => [
      name,
      { adhanMode: 'auto', adhanAdjustMin: 0, jamaatMode: 'offset', jamaatOffsetMin: name === 'maghrib' ? 5 : 15 },
    ]),
  ),
  jumuah: [{ seq: 1, jamaatTime: '13:30' }],
  notify: false,
};

/** Counts taps per task. */
class Taps {
  readonly counts: Record<string, number> = {};
  private task = '';

  start(task: string) {
    this.task = task;
    this.counts[task] = 0;
  }

  async tap(target: Locator) {
    this.counts[this.task] = (this.counts[this.task] ?? 0) + 1;
    await target.click();
  }
}

/** Back on Admin Home (the "Published" / "Saved" screen's Done is not part of the task). */
async function home(admin: Page) {
  await admin.goto(`${ADMIN_URL}/`);
  await expect(admin.getByRole('button', { name: 'Prayer Times', exact: true })).toBeVisible();
}

test.describe('T3.12 usability script — tap counts', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('the five tasks each take at most 6 taps from Admin Home', async ({ page, browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'the virtual authenticator is a Chromium DevTools feature');
    test.setTimeout(180_000);
    await resetRateLimits(page.request);

    await virtualAuthenticator(page);
    const token = await seedSuperAdminInvite(page.request, 'Test Owner', 'en');
    await registerWithInvite(page, `${ADMIN_URL}/invite#${token}`, 'Test Owner', 'en');
    const created = await page.request.post(`${ADMIN_URL}/api/super/masjids`, {
      headers: CSRF,
      data: {
        name: `Test Masjid Usability ${Date.now().toString(36)}`,
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
    const taps = new Taps();
    try {
      const admin = await phone.newPage();
      await virtualAuthenticator(admin);
      await registerWithInvite(admin, inviteUrl, 'Test Imam', 'en');
      await admin.getByRole('checkbox', { name: 'I have read and I agree' }).check();
      await admin.getByRole('button', { name: 'Continue' }).click();
      await expect(admin.getByRole('button', { name: 'Prayer Times', exact: true })).toBeVisible(); // undertaking saved
      const timings = await admin.request.put(`${ADMIN_URL}/api/admin/masjids/${masjidId}/timings`, {
        headers: { ...CSRF, 'If-Match': '"0"' },
        data: TIMINGS,
      });
      expect(timings.status()).toBe(200);
      expect(
        (await page.request.post(`${ADMIN_URL}/api/super/masjids/${masjidId}/activate`, { headers: CSRF })).status(),
      ).toBe(204);
      await home(admin);
      const top = admin.locator('section[data-screen]:not([inert])');

      // 1. Maghrib jamaat 5 → 10 minutes after the adhan.
      taps.start('maghrib');
      await taps.tap(admin.getByRole('button', { name: 'Prayer Times', exact: true }));
      await taps.tap(admin.locator('[data-prayer="maghrib"]').getByRole('button', { name: /^Jamaat/ }));
      await taps.tap(admin.getByRole('dialog').getByRole('button', { name: '10 minutes after adhan' }));
      await taps.tap(admin.getByRole('dialog').getByRole('button', { name: 'Done' }));
      await taps.tap(admin.getByRole('button', { name: 'Save timings' }));
      await taps.tap(
        admin.getByRole('dialog', { name: 'Save these timings?' }).getByRole('button', { name: 'Save', exact: true }),
      );
      await expect(admin.getByRole('heading', { name: 'Saved' })).toBeVisible();
      const saved = await admin.request.get(`${ADMIN_URL}/api/admin/masjids/${masjidId}/timings`);
      expect(JSON.stringify(await saved.json())).toMatch(/"maghrib":\{[^}]*"jamaatOffsetMin":10/);
      await home(admin);

      // 2. "No water supply", 10:00 AM – 2:00 PM (both wheels in one sheet), published.
      taps.start('noWater');
      await taps.tap(admin.getByRole('button', { name: 'Notice', exact: true }));
      await taps.tap(admin.getByRole('button', { name: 'No water supply' }));
      await taps.tap(admin.getByRole('button', { name: /^From/ }));
      await taps.tap(admin.getByRole('dialog').getByRole('button', { name: 'Done' }));
      await expect(admin.getByRole('button', { name: /^To.*2:00/ })).toBeVisible();
      await taps.tap(admin.getByRole('button', { name: 'Next: Preview' }));
      await taps.tap(admin.getByRole('button', { name: 'Publish', exact: true }));
      await expect(admin.getByRole('heading', { name: 'Published' })).toBeVisible();
      await home(admin);

      // 3. Today's hadith: the suggestion, as it is.
      taps.start('hadith');
      await taps.tap(admin.getByRole('button', { name: 'Hadith / Ayah', exact: true }));
      await taps.tap(admin.getByRole('button', { name: 'Use this' }));
      await taps.tap(admin.getByRole('button', { name: 'Next: Preview' }));
      await taps.tap(admin.getByRole('button', { name: 'Publish', exact: true }));
      await expect(admin.getByRole('heading', { name: 'Published' })).toBeVisible();
      await home(admin);

      // 4. Illness dua request: the ready message, the name kept private (the default), a library dua.
      taps.start('dua');
      await taps.tap(admin.getByRole('button', { name: 'Dua Request', exact: true }));
      await taps.tap(admin.locator('[data-category="illness"]'));
      await expect(admin.getByRole('switch', { name: /^Keep name private/ })).toHaveAttribute('aria-checked', 'true');
      await taps.tap(admin.getByRole('button', { name: 'Next: Choose the dua' }));
      await taps.tap(top.locator('[data-entry]').first());
      await expect(
        admin.locator('[data-preview-locale]').getByText('For a brother or sister from our community'),
      ).toBeVisible();
      await taps.tap(admin.getByRole('button', { name: 'Publish', exact: true }));
      await expect(admin.getByRole('heading', { name: 'Published' })).toBeVisible();
      await home(admin);

      // 5. Delete the "No water" post.
      taps.start('deletePost');
      await taps.tap(admin.getByRole('button', { name: 'My Posts', exact: true }));
      const post = top.locator('[data-post]').filter({ hasText: 'No water supply' });
      await taps.tap(post.getByRole('button', { name: 'Delete' }));
      await taps.tap(admin.getByRole('alertdialog').getByRole('button', { name: 'Delete' }));
      await expect(post).toHaveAttribute('data-status', 'deleted');
    } finally {
      await phone.close();
    }

    await test
      .info()
      .attach('tap-counts', { body: JSON.stringify(taps.counts, null, 2), contentType: 'application/json' });
    test.info().annotations.push({ type: 'tap-counts', description: JSON.stringify(taps.counts) });
    for (const [task, count] of Object.entries(taps.counts)) {
      expect(count, `${task}: ${String(count)} taps`).toBeLessThanOrEqual(TAP_BUDGET);
    }
    expect(Object.keys(taps.counts)).toHaveLength(5);
  });
});
