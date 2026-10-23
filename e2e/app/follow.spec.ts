import { expect, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';
import { followedIds } from '../support/device.ts';

// PHASE_02 T2.5 — following without the camera (07 A4 "Enter code", A16 `/m/:code` landing, DECISIONS #14). The camera
// journey is `scan.scan.spec.ts` (Chromium fake camera). Needs the dev seed (TESTA001 = Test Masjid Alpha).

const DETAIL = /\/masjid\/[0-9a-f-]{36}$/;
/** On Masjid Detail: the URL and its screen (WebKit commits the URL change a moment later than it reports it). */
async function onDetail(page: Page) {
  await expect(page).toHaveURL(DETAIL);
  await expect(page.locator('section[data-screen]:not([inert]) h1')).toBeVisible();
}

test('enter code: typing the 8 characters finds the masjid, Follow opens Masjid Detail, Back returns Home', async ({
  page,
  expectAxeClean,
}) => {
  await page.goto(`${APP_URL}/scan?enter=code`);
  const sheet = page.getByRole('dialog', { name: 'Enter masjid code' });
  await expect(sheet).toBeVisible();
  const code = sheet.getByRole('textbox', { name: 'Masjid code' });
  await expect(code).toBeFocused();
  await code.pressSequentially('zzzzzzzu'); // U is not in the code alphabet → invalid at once, nothing sent
  await expect(sheet.getByRole('alert')).toHaveText('This code isn’t valid. Check it and try again.');
  await code.fill('');
  await code.pressSequentially('zzzz-0000'); // well-formed, no such masjid
  await expect(sheet.getByRole('alert')).toHaveText(
    'We couldn’t find this masjid. Please check the code and try again.',
  );
  await code.fill('');
  await code.pressSequentially('test-a001'); // auto-submits when complete

  const preview = page.getByRole('dialog', { name: 'Follow masjid' });
  await expect(preview.getByRole('heading', { name: 'Test Masjid Alpha' })).toBeVisible();
  await expect(preview.getByText('Banjara Hills, Hyderabad')).toBeVisible();
  await expectAxeClean();
  await preview.getByRole('button', { name: 'Follow masjid' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'You now follow Test Masjid Alpha' })).toBeVisible();
  await onDetail(page);
  expect(await followedIds(page)).toHaveLength(1);

  // Opened as the first page: the in-app back goes to Home (the browser's back would leave the site).
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(`${APP_URL}/`);
  await expect(page.getByRole('navigation')).toBeVisible();
});

test('a pasted follow link works in the code box; an already followed masjid offers "Open"', async ({ page }) => {
  await page.goto(`${APP_URL}/scan?enter=code`);
  const code = page.getByRole('textbox', { name: 'Masjid code' });
  await code.fill(`${new URL(APP_URL).origin}/m/TESTA001`);
  const preview = page.getByRole('dialog', { name: 'Follow masjid' });
  await preview.getByRole('button', { name: 'Follow masjid' }).click();
  await onDetail(page);

  await page.goto(`${APP_URL}/scan?enter=code`);
  await page.getByRole('textbox', { name: 'Masjid code' }).pressSequentially('TESTA001');
  await expect(page.getByText('You already follow this masjid.')).toBeVisible();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await onDetail(page);
  expect(await followedIds(page)).toHaveLength(1);
});

test('/m/:code landing: follow from the link (iPhone Safari shows the "follow it in the app" explainer first)', async ({
  page,
  browserName,
  expectAxeClean,
}) => {
  await page.goto(`${APP_URL}/m/test-a001`);
  await expect(page.getByRole('heading', { level: 1, name: 'Test Masjid Alpha' })).toBeVisible({ timeout: 15_000 });
  if (browserName === 'webkit') {
    // DECISIONS #14: following belongs in the Home Screen app — show how, with the code large.
    await expect(page.getByRole('heading', { name: 'Follow it in the Masjid Connect app' })).toBeVisible();
    await expect(page.getByText('TEST-A001')).toBeVisible();
    await expectAxeClean();
    await page.getByRole('button', { name: 'Use it here in Safari instead' }).click();
  } else {
    await expect(page.getByText('TEST-A001')).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Follow masjid' }).click();
  await onDetail(page);
  expect(await followedIds(page)).toHaveLength(1);
});

test('/m/:code with an unknown code: friendly not-found with "Scan again"', async ({ page }) => {
  await page.goto(`${APP_URL}/m/ZZZZ0000`);
  // WebKit on a busy runner: the strings chunk + lookup can take a few seconds.
  await expect(page.getByRole('heading', { name: 'Masjid not found' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Scan again' }).click();
  await expect(page).toHaveURL(`${APP_URL}/scan`);
  await expect(page.getByRole('heading', { name: 'Scan masjid QR' })).toBeVisible();
});
