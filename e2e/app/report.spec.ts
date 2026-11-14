import { APP_LOCALES, expect, test } from '@mc/config/playwright';
import type { Locator, Page } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';
import { followByCode, registerDevice } from '../support/device.ts';

// PHASE_08 T8.1 — reporting from the app (00 §4.7): "…" on a post → Report → a reason (Send stays off until one is
// picked) → optional details → Send → "Thank you"; the request carries only the target, reason, details and the
// Turnstile token (no device data beyond the auth header); a masjid from Masjid Detail's menu; offline says so and
// sends nothing; the sheet in 4 locales, Urdu mirrored, axe clean. Only one post report per run: the worker hides a
// post that 10 devices report within an hour, and the seed posts are shared with other specs.

const POST = 'seedA0000000'; // a published Alpha post (dev seed)
const screen = (page: Page) => page.locator('section[data-screen]:not([inert])');
const dialog = (page: Page, name: string | RegExp) => page.getByRole('dialog', { name });
/** Taps a reason card (as a person does — the native radio inside is visually hidden) and checks it took. */
async function pick(sheet: Locator, reason: string) {
  await sheet.getByText(reason, { exact: true }).click();
  await expect(sheet.getByRole('radio', { name: reason })).toBeChecked();
}

async function openPostReport(page: Page) {
  await page.goto(APP_URL);
  await registerDevice(page);
  await followByCode(page, APP_URL, ['TESTA001']);
  await page.goto(`${APP_URL}/items/${POST}`);
  await screen(page).locator('[data-more-menu]').click();
}

test('a post: "…" → Report → reason → Send → Thank you; only what is needed is sent', async ({
  page,
  expectAxeClean,
  capture,
}) => {
  await openPostReport(page);
  await dialog(page, 'Options').getByRole('button', { name: 'Report' }).click();
  const sheet = dialog(page, 'Report this post');
  await expect(sheet).toBeVisible();
  const send = sheet.getByRole('button', { name: 'Send report' });
  await expect(send).toBeDisabled();
  await expect(sheet).toContainText('Photos or details of someone shared without permission');
  await expectAxeClean();
  await capture('report-sheet');

  await pick(sheet, 'Misleading or false');
  await sheet.getByRole('textbox', { name: /Details/u }).fill('Placeholder details');
  const answer = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/reports') && response.request().method() === 'POST',
  );
  await send.click();
  const response = await answer;
  expect(response.status()).toBe(201);
  const body = response.request().postDataJSON() as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(['details', 'reason', 'targetPublicId', 'targetType', 'turnstileToken']);
  expect(body).toMatchObject({
    targetType: 'item',
    targetPublicId: POST,
    reason: 'misleading',
    details: 'Placeholder details',
  });

  const thanks = dialog(page, 'Thank you');
  await expect(thanks.locator('[data-report-sent]')).toContainText('The masjid never sees who sent a report.');
  await capture('report-sent');
  await thanks.getByRole('button', { name: 'Done' }).click();
  await expect(thanks).toBeHidden();
  // The post is still there: a report never hides anything by itself.
  await expect(screen(page).locator('article')).toBeVisible();
});

test('a masjid: Masjid Detail menu → Report → fraud → Thank you', async ({ page }) => {
  await page.goto(APP_URL);
  await registerDevice(page);
  const [alpha = ''] = await followByCode(page, APP_URL, ['TESTA001']);
  await page.goto(`${APP_URL}/masjid/${alpha}`);
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Report' }).click();
  const sheet = dialog(page, 'Report this masjid');
  await pick(sheet, 'Fraud or fake donation');
  const answer = page.waitForResponse((response) => response.url().endsWith('/api/v1/reports'));
  await sheet.getByRole('button', { name: 'Send report' }).click();
  const response = await answer;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toMatchObject({
    targetType: 'masjid',
    targetPublicId: alpha,
    reason: 'fraud',
  });
  await expect(dialog(page, 'Thank you')).toBeVisible();
});

test('offline: the sheet says so and nothing is sent', async ({ page, context }) => {
  await openPostReport(page);
  await dialog(page, 'Options').getByRole('button', { name: 'Report' }).click();
  const sheet = dialog(page, 'Report this post');
  await pick(sheet, 'Something else');
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/reports')) sent.push(request.url());
  });
  await context.setOffline(true);
  await sheet.getByRole('button', { name: 'Send report' }).click();
  await expect(sheet.getByRole('alert')).toHaveText("You're offline. Try again when you're connected.");
  await context.setOffline(false);
  expect(sent).toEqual([]);
});

for (const locale of APP_LOCALES) {
  test.describe(`report sheet (${locale})`, () => {
    test.use({ appLocale: locale });

    test('the sheet in this language; axe clean', async ({ page, expectAxeClean, capture }) => {
      await openPostReport(page);
      await page.locator('[data-report-open]').click();
      const sheet = page.locator('[data-report-form]');
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole('radio')).toHaveCount(7);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
      await expectAxeClean();
      await capture('report-sheet');
    });
  });
}
