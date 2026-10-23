import { expect, test } from '@mc/config/playwright';

import { APP_URL } from '../../playwright.config.ts';
import { followByCode } from '../support/device.ts';

// PHASE_02 T2.9 — A6 Prayer Timings (07 A6): from Home's next-prayer panel; the table shows the seeded Alpha
// configuration (Dhuhr / Jumu'ah jamaat fixed 13:30, Isha jamaat fixed 20:30, Sunrise muted, calculated dots); date
// stepper and date sheet; Jumu'ah card with khutbah; special dates. Needs the dev seed (TESTA001).

test('prayer timings: daily table, stepping days, Jumu’ah and special dates', async ({
  page,
  expectAxeClean,
  capture,
}) => {
  await page.goto(APP_URL);
  await followByCode(page, APP_URL, ['TESTA001']);
  const card = page.getByRole('list', { name: 'My Masjids' }).locator(':scope > li').first();
  await card.getByRole('button', { name: /Next Prayer/ }).click();
  await expect(page).toHaveURL(/\/masjid\/[0-9a-f-]{36}\/timings$/);
  const screen = page.locator('section[data-screen]:not([inert])');
  await expect(screen.getByRole('heading', { level: 1, name: 'Prayer Timings' })).toBeVisible();
  await expect(screen.getByText('Test Masjid Alpha')).toBeVisible();

  const table = screen.getByRole('table');
  await expect(table.getByRole('rowheader')).toHaveCount(6);
  await expect(table.getByRole('rowheader').nth(1)).toHaveText('Sunrise');
  await expect(table.getByRole('row').filter({ hasText: /Dhuhr|Jumu’ah/ })).toContainText('1:30 PM');
  await expect(table.getByRole('row').filter({ hasText: 'Isha' })).toContainText('8:30 PM');
  await expect(table.getByText('Calculated for this masjid’s location').first()).toBeAttached();
  await expect(screen.getByRole('button', { name: /^Choose a date, Today,/ })).toBeVisible();
  await expectAxeClean();
  await capture('prayer-timings');

  // Next day, then back to today.
  await screen.getByRole('button', { name: 'Next day' }).click();
  await expect(screen.getByRole('button', { name: /^Choose a date, Today,/ })).toHaveCount(0);
  await screen.getByRole('button', { name: 'Previous day' }).click();
  await expect(screen.getByRole('button', { name: /^Choose a date, Today,/ })).toBeVisible();
  // The earliest day is a week back.
  for (let step = 0; step < 7; step += 1) await screen.getByRole('button', { name: 'Previous day' }).click();
  await expect(screen.getByRole('button', { name: 'Previous day' })).toBeDisabled();
  // The date sheet.
  await screen.getByRole('button', { name: /^Choose a date/ }).click();
  await expect(page.getByRole('dialog', { name: 'Choose a date' })).toBeVisible();
  await page.keyboard.press('Escape');

  await screen.getByRole('tab', { name: 'Jumu’ah' }).click();
  const jumuah = screen.getByRole('tabpanel');
  await expect(jumuah.getByText('Jumu’ah 1')).toBeVisible();
  await expect(jumuah).toContainText('Khutbah 1:15 PM');
  await expect(jumuah).toContainText('2:30 PM');

  await screen.getByRole('tab', { name: 'Special Dates' }).click();
  await expect(screen.getByRole('tabpanel')).toContainText('Annual gathering');
});
