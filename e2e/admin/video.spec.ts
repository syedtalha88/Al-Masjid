import { axeViolations, expect, test } from '@mc/config/playwright';
import { devices } from '@playwright/test';

import { ADMIN_URL } from '../../playwright.config.ts';
import {
  CSRF,
  HOOKS,
  registerWithInvite,
  resetRateLimits,
  seedSuperAdminInvite,
  virtualAuthenticator,
} from './helpers.ts';

// PHASE_06 T6.2 — B10 Bayan Video end to end (07 B10): the admin opens "Bayan Video" from Home, taps "Paste link" (the
// clipboard holds a YouTube share link), the link is checked and the server's preview card shows our thumbnail copy
// with YouTube's title; choosing "Sisters only" shows the Unlisted warning; the ownership tick; Publish → the success
// moment, and the list shows the bayan as published for sisters. A look-alike link is refused on the phone at once and
// a private video (mock id) by the server. The local stack checks links with the mock adapter (VIDEO_LOOKUP=mock).

const run = Date.now().toString(36); // the stack database outlives a run
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
const LINK = 'https://youtu.be/AbC_123-xYz?si=Shar3Token';

test.describe('B10 bayan video (T6.2)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('paste → preview → sisters only (warning) → publish → listed', async ({
    page,
    browser,
    browserName,
    capture,
  }) => {
    test.skip(browserName !== 'chromium', 'the virtual authenticator is a Chromium DevTools feature');
    test.setTimeout(240_000);
    await resetRateLimits(page.request);

    await virtualAuthenticator(page);
    const token = await seedSuperAdminInvite(page.request, 'Test Owner', 'en');
    await registerWithInvite(page, `${ADMIN_URL}/invite#${token}`, 'Test Owner', 'en');
    const created = await page.request.post(`${ADMIN_URL}/api/super/masjids`, {
      headers: CSRF,
      data: {
        name: `Test Masjid Bayan ${run}`,
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
      data: { displayName: 'Test Imam', uiLocale: 'en', masjidId, role: 'editor' },
    });
    const { inviteUrl } = (await invited.json()) as { inviteUrl: string };

    const phone = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
    await phone.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ADMIN_URL });
    try {
      const admin = await phone.newPage();
      await virtualAuthenticator(admin);
      await registerWithInvite(admin, inviteUrl, 'Test Imam', 'en');
      await admin.getByRole('checkbox', { name: 'I have read and I agree' }).check();
      await admin.getByRole('button', { name: 'Continue' }).click();
      const tile = admin.getByRole('button', { name: 'Bayan Video', exact: true });
      await expect(tile).toBeVisible();
      expect(
        (
          await admin.request.put(`${ADMIN_URL}/api/admin/masjids/${masjidId}/timings`, {
            headers: { ...CSRF, 'If-Match': '"0"' },
            data: TIMINGS,
          })
        ).status(),
      ).toBe(200);
      expect(
        (await page.request.post(`${ADMIN_URL}/api/super/masjids/${masjidId}/activate`, { headers: CSRF })).status(),
      ).toBe(204);

      await tile.click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/videos`);
      await expect(admin.getByText('No bayans yet')).toBeVisible();
      await admin.getByRole('button', { name: 'Add a bayan' }).click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/videos/new`);
      const editor = admin.locator('[data-video-editor]');

      // A look-alike link: refused on the phone, no request.
      const field = editor.getByRole('textbox', { name: 'YouTube link' });
      await field.fill('https://youtube.com.evil.example/watch?v=AbC_123-xYz');
      await expect(editor.getByText('This is not a YouTube video link')).toBeVisible();

      // A private video (mock id): the server says so.
      await field.fill('https://www.youtube.com/watch?v=privateVid1');
      await editor.getByRole('button', { name: 'Check link' }).click();
      await expect(
        admin.locator('p', { hasText: /^This video is private or can.t be shown in other apps\.$/u }),
      ).toBeVisible();

      // "Paste link" reads the clipboard and checks at once.
      await admin.evaluate((text) => navigator.clipboard.writeText(text), LINK);
      await editor.getByRole('button', { name: 'Paste link' }).click();
      await expect(field).toHaveValue(LINK);
      const preview = editor.locator('[data-video-preview]');
      await expect(preview).toBeVisible();
      await expect(preview.locator('img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
      await expect(preview.getByRole('textbox', { name: 'Title' })).toHaveValue('Test bayan AbC_123-xYz');
      await preview.getByRole('textbox', { name: 'Title' }).fill('Test Friday bayan');
      await preview.getByRole('textbox', { name: /^Speaker/ }).fill('Test Speaker');

      await editor.getByText('Sisters only', { exact: true }).click(); // radio cards are tapped by their text
      await expect(editor.getByRole('radio', { name: 'Sisters only' })).toBeChecked();
      await expect(editor.locator('[data-video-sisters-warning]')).toContainText(
        'Anyone who has this YouTube link can watch it outside the app. Upload it as Unlisted.',
      );
      await expect(editor.getByRole('button', { name: 'Publish' })).toBeDisabled();
      await editor.getByRole('checkbox', { name: /^This bayan is our masjid's/ }).check();
      expect(await axeViolations(admin)).toEqual([]);
      await capture('b10-video-new', { target: editor });
      await editor.getByRole('switch', { name: /^Notify followers/ }).click(); // no followers here: publish quietly
      await editor.getByRole('button', { name: 'Publish' }).click();
      await expect(admin.getByRole('button', { name: 'Done' })).toBeVisible();
      await admin.getByRole('button', { name: 'Done' }).click();

      await expect(admin).toHaveURL(`${ADMIN_URL}/videos`);
      const row = admin.locator('[data-video]').filter({ hasText: 'Test Friday bayan' });
      await expect(row).toBeVisible();
      await expect(row.getByText('Published')).toBeVisible();
      await expect(row.getByText('Sisters only')).toBeVisible();
      expect(await axeViolations(admin)).toEqual([]);
      await capture('b10-videos', { target: admin.locator('[data-videos]') });
    } finally {
      await phone.close();
    }
  });
});
