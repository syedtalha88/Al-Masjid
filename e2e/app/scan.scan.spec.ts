import { expect, test } from '@mc/config/playwright';

import { APP_URL } from '../../playwright.config.ts';
import { followedIds } from '../support/device.ts';

// 10 §6 journey 2 (PHASE_02 T2.5): the Scan modal with Chromium's fake camera playing e2e/support/scan-feed.ts — first a
// QR from another site (refused: message, no navigation), then the seeded masjid's follow QR → preview sheet → Follow
// → Masjid Detail. Desktop Chromium has no native BarcodeDetector, so the WebAssembly reader (DECISIONS #94) runs
// under the real CSP. Runs in the `scan` project only.

test('journey 2: scan refuses a foreign QR, then follows the masjid from its poster QR', async ({ page }) => {
  await page.goto(APP_URL);
  await page
    .getByRole('link', { name: 'Scan QR code' })
    .or(page.getByRole('button', { name: 'Scan QR code' }))
    .click();
  await expect(page.getByRole('heading', { name: 'Scan masjid QR' })).toBeVisible();

  // The foreign QR (first 3 s of the feed): refused, the scanner stays.
  await expect(page.getByRole('status').filter({ hasText: 'This is not a Masjid Connect QR code' })).toBeVisible({
    timeout: 15_000,
  });
  expect(new URL(page.url()).pathname).toBe('/scan');

  // The masjid's QR: preview sheet.
  const preview = page.getByRole('dialog', { name: 'Follow masjid' });
  await expect(preview.getByRole('heading', { name: 'Test Masjid Alpha' })).toBeVisible({ timeout: 15_000 });
  expect(await followedIds(page)).toHaveLength(0);
  await preview.getByRole('button', { name: 'Follow masjid' }).click();
  await expect(page).toHaveURL(/\/masjid\/[0-9a-f-]{36}$/);
  expect(await followedIds(page)).toHaveLength(1);

  // Back returns to where Scan was opened.
  await page.goBack();
  await expect(page).toHaveURL(`${APP_URL}/`);
});

test('the torch toggle appears only when the camera supports it; close returns Home', async ({ page }) => {
  await page.goto(`${APP_URL}/scan`);
  await expect(page.getByRole('heading', { name: 'Scan masjid QR' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /QR code/ })).toBeVisible();
  // Chromium's fake camera has no torch.
  await expect(page.getByRole('button', { name: 'Flashlight' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(`${APP_URL}/`);
});
