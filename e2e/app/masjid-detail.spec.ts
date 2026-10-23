import { expect, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';
import { followByCode, registerDevice } from '../support/device.ts';

// PHASE_02 T2.8 — A5 Masjid Detail (07 A5): hero + overlapping sheet, Verified, location, Notifications (mute → server
// PATCH), Share (fallback sheet), Directions (Google Maps in a new tab), tabs, section rows with unseen counts, solid bar
// on scroll, unfollow from the "…" menu. Needs the dev seed (TESTA001 = Test Masjid Alpha).

async function openAlpha(page: Page, register = false) {
  await page.addInitScript(() => {
    // The fallback share sheet (no Web Share) — deterministic across engines.
    Reflect.deleteProperty(Navigator.prototype, 'share');
  });
  await page.goto(APP_URL);
  if (register) await registerDevice(page);
  await followByCode(page, APP_URL, ['TESTA001']);
  const card = page.getByRole('list', { name: 'My Masjids' }).locator(':scope > li').first();
  await card.getByRole('button', { name: /Test Masjid Alpha/ }).click();
  await expect(page).toHaveURL(/\/masjid\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Test Masjid Alpha' })).toBeVisible();
}

const screen = (page: Page) => page.locator('section[data-screen]:not([inert])');

test('header, actions, tabs and section rows', async ({ page, expectAxeClean, capture }) => {
  await openAlpha(page);
  const detail = screen(page);
  await expect(detail.getByText('Verified')).toBeVisible();
  await expect(detail.getByText(/Banjara Hills, Hyderabad/)).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Notifications' })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Share' })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Directions' })).toBeVisible();
  await expect(detail.getByRole('button', { name: /Next Prayer/ })).toBeVisible();
  await expect(detail.getByRole('button', { name: /Announcements/ }).last()).toBeVisible();
  await expectAxeClean();
  await capture('masjid-detail');

  await detail.getByRole('tab', { name: 'Prayer Timings' }).click();
  await expect(detail.getByRole('columnheader', { name: 'Jamaat' })).toBeVisible();
  await expect(detail.getByRole('rowheader')).toHaveCount(5);
  await detail.getByRole('tab', { name: 'Announcements' }).click();
  await expect(detail.getByRole('tabpanel').getByRole('listitem').first()).toBeVisible();

  // Scrolling the hero away makes the bar solid with the name.
  await detail.locator('[data-screen-scroll]').evaluate((node) => {
    node.scrollTop = 400;
  });
  await expect.poll(() => detail.locator('header p').evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
});

test('share falls back to WhatsApp / Copy link; directions open Google Maps', async ({ page, context }) => {
  await context.route('https://www.google.com/**', (route) => route.fulfill({ status: 200, body: 'maps' }));
  await openAlpha(page);
  const detail = screen(page);
  await detail.getByRole('button', { name: 'Share' }).click();
  const sheet = page.getByRole('dialog', { name: 'Share masjid' });
  await expect(sheet.getByRole('button', { name: 'Share on WhatsApp' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Copy link' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  const popup = page.waitForEvent('popup');
  await detail.getByRole('button', { name: 'Directions' }).click();
  expect((await popup).url()).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=17\./);
});

test('Notifications mutes this masjid on the server; unfollow from the menu', async ({ page }) => {
  await openAlpha(page, true);
  const detail = screen(page);
  const bell = detail.getByRole('button', { name: 'Notifications' });
  await expect(bell).toHaveAttribute('aria-pressed', 'true');
  // The queued follow reaches the server first (registered device), then the mute is a PATCH.
  const patched = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().includes('/devices/me/follows/'),
  );
  await expect
    .poll(async () => {
      await bell.click();
      return bell.getAttribute('aria-pressed');
    })
    .toBe('false');
  expect((await (await patched).response())?.status()).toBe(204);
  await expect(page.getByRole('status').filter({ hasText: 'Notifications are off for this masjid' })).toBeVisible();

  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('dialog', { name: 'Test Masjid Alpha' }).getByRole('button', { name: 'Unfollow' }).click();
  await page
    .getByRole('alertdialog')
    .or(page.getByRole('dialog', { name: /Unfollow/ }))
    .getByRole('button', { name: 'Unfollow' })
    .click();
  await expect(page).toHaveURL(`${APP_URL}/`);
  await expect(page.getByRole('heading', { name: 'Add your first masjid' })).toBeVisible();
});
