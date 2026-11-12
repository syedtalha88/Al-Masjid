import { APP_LOCALES, expect, test } from '@mc/config/playwright';
import type { Page, Request } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';
import { registerDevice, storedDevice } from '../support/device.ts';

// PHASE_05 T5.9 — A24 My zakat (07 A24, 00 §4.15): a tracker that exists only on the phone. Acceptance: nothing about
// zakat is sent to the server (every request made while it is used is checked), "Clear all data" removes it, and the
// notice is there in all four languages. The remaining amount never goes below ₹0. Fake amounts and notes only.

const screen = (page: Page) => page.locator('section[data-screen]:not([inert])');
const NOTICE_EN =
  'Saved only on this phone. Clear all data or a new phone removes it. The app does not calculate zakat.';
const NOTE = 'Test zakat note';
const YEAR = 'Test year 1';

/** Types an amount on the NumberPad of the open sheet (keys are Latin digits in every language). */
async function typeAmount(page: Page, form: string, rupees: string) {
  const pad = page.locator(`${form} [role="group"]`);
  for (const key of rupees) await pad.getByRole('button', { name: key, exact: true }).click();
}

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly body: string;
}

/** Every request the page makes from now on. */
function watchRequests(page: Page): Sent[] {
  const sent: Sent[] = [];
  page.on('request', (request: Request) => {
    sent.push({ method: request.method(), url: request.url(), body: request.postData() ?? '' });
  });
  return sent;
}

/** The requests that would carry something about zakat to a server: any write, or the note / label / word in a URL. */
const leaks = (sent: readonly Sent[]) =>
  sent.filter(
    ({ method, url, body }) =>
      method !== 'GET' ||
      body !== '' ||
      // Static files of the screen itself (its code chunk) are not data; API and other paths must not mention it.
      (new URL(url).pathname.startsWith('/api/') && /zakat/i.test(url)) ||
      [NOTE, YEAR, '500000', '120000'].some((secret) => decodeURIComponent(url).includes(secret)),
  );

test('A24: owed, payments, remaining never below ₹0; nothing is sent; Clear all data removes it', async ({
  page,
  expectAxeClean,
  capture,
}) => {
  test.slow(); // WebKit on the Windows dev PC fetches one resource at a time.
  await page.goto(APP_URL);
  await registerDevice(page);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Settings/ })
    .click();
  await screen(page)
    .getByRole('button', { name: /^My zakat Only on this phone/ })
    .click();
  const view = screen(page).locator('[data-zakat]');
  await expect(view.locator('[data-zakat-notice]')).toHaveText(NOTICE_EN);
  await expect(view.locator('[data-zakat-remaining]')).toHaveText('₹0');
  await expect(view.getByText('No payments logged yet.')).toBeVisible();
  // The screen and its strings are loaded: from here on, every request counts.
  await page.waitForLoadState('networkidle');
  const sent = watchRequests(page);

  // The amount owed, typed by the person; the year label starts as this Hijri year and can be changed.
  await view.getByRole('button', { name: 'Set amount owed' }).click();
  const owed = page.getByRole('dialog', { name: 'Amount owed' });
  await expect(owed.getByText('The app does not calculate zakat.', { exact: false })).toBeVisible();
  const year = owed.getByRole('textbox', { name: /^Year/ });
  await expect(year).toHaveValue(/^1[45]\d\d AH$/);
  await year.fill(YEAR);
  await typeAmount(page, '[data-zakat-owed-form]', '5000');
  await owed.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(owed).toBeHidden();
  await expect(view.locator('[data-zakat-remaining]')).toHaveText('₹5,000');
  await expect(view.locator('[data-zakat-label]')).toHaveText(YEAR);

  // A payment: amount and a note; what remains goes down.
  const add = page.getByRole('dialog', { name: 'Add payment' });
  await view.getByRole('button', { name: 'Add payment' }).click();
  await expect(add.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await typeAmount(page, '[data-zakat-log]', '1200');
  await add.getByRole('textbox', { name: /^Note/ }).fill(NOTE);
  await add.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('p', { hasText: /^Saved in My zakat$/ })).toBeVisible();
  await expect(add).toBeHidden();
  await expect(view.locator('[data-zakat-remaining]')).toHaveText('₹3,800');
  await expect(view.locator('[data-zakat-given]')).toHaveText('₹1,200');
  const payments = view.locator('[data-zakat-payment]');
  await expect(payments).toHaveCount(1);
  await expect(payments.first()).toContainText('₹1,200');
  await expect(payments.first()).toContainText(NOTE);

  // More than was owed: the remaining amount stays at ₹0, never negative.
  await view.getByRole('button', { name: 'Add payment' }).click();
  await typeAmount(page, '[data-zakat-log]', '9000');
  await add.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(add).toBeHidden();
  await expect(payments).toHaveCount(2);
  await expect(view.locator('[data-zakat-remaining]')).toHaveText('₹0');
  await expect(view.locator('[data-zakat-given]')).toHaveText('₹10,200');
  await expect(payments.first()).toContainText('₹9,000'); // newest first

  // A mistake is removed after a confirmation.
  await view.getByRole('button', { name: 'Remove payment of ₹9,000' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Remove this payment?' });
  await expect(confirm).toContainText('₹9,000');
  await confirm.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(payments).toHaveCount(1);
  await expect(view.locator('[data-zakat-remaining]')).toHaveText('₹3,800');
  await page.waitForTimeout(600); // the dialog and the toast settle before axe reads colours
  await expectAxeClean();
  await capture('zakat');

  // It is in the device document — whole paise — and nowhere else: no request wrote anything or mentioned it.
  await expect
    .poll(async () => (await storedDevice(page))?.['zakat'])
    .toMatchObject({
      label: YEAR,
      owedPaise: 500_000,
      payments: [{ amountPaise: 120_000, note: NOTE }],
    });
  await page.waitForLoadState('networkidle');
  expect(leaks(sent)).toEqual([]);

  // My data lists it under "On this phone"; Clear all data removes it with everything else.
  await page.goBack();
  await screen(page)
    .getByRole('button', { name: /^My data/ })
    .click();
  const data = screen(page);
  await expect(data.locator('div', { hasText: /^My zakat payments1$/ })).toBeVisible();
  await data.getByRole('button', { name: 'Clear all data' }).click();
  await page
    .getByRole('alertdialog', { name: 'Clear all data?' })
    .getByRole('button', { name: 'Clear all data' })
    .click();
  await expect(page.getByRole('heading', { name: 'Assalamu Alaikum' })).toBeVisible();
  expect((await storedDevice(page))?.['zakat']).toBeUndefined();
});

test('A24: "Start a new year" empties the tracker after a confirmation', async ({ page }) => {
  await page.goto(`${APP_URL}/settings/zakat`);
  const view = screen(page).locator('[data-zakat]');
  await expect(view.getByRole('button', { name: 'Start a new year' })).toHaveCount(0);
  await view.getByRole('button', { name: 'Add payment' }).click();
  await typeAmount(page, '[data-zakat-log]', '700');
  await page.getByRole('dialog', { name: 'Add payment' }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(view.locator('[data-zakat-payment]')).toHaveCount(1);
  // Nothing owed was entered: nothing remains, and the list still keeps the payment.
  await expect(view.locator('[data-zakat-remaining]')).toHaveText('₹0');

  await view.getByRole('button', { name: 'Start a new year' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Start a new year?' });
  await expect(confirm).toContainText('removes the amount owed and every payment');
  await confirm.getByRole('button', { name: 'Start again' }).click();
  await expect(view.locator('[data-zakat-payment]')).toHaveCount(0);
  await expect(view.locator('[data-zakat-given]')).toHaveText('₹0');
  await expect.poll(async () => (await storedDevice(page))?.['zakat']).toBeUndefined();
});

for (const locale of APP_LOCALES) {
  test.describe(`A24 My zakat (${locale})`, () => {
    test.use({ appLocale: locale });

    test('the notice, the amounts and the list in this language; Urdu mirrored', async ({
      page,
      expectAxeClean,
      capture,
    }) => {
      await page.goto(`${APP_URL}/settings/zakat`);
      const view = screen(page).locator('[data-zakat]');
      // The notice is translated (10 §: every string in four locales), never the English text or a raw key.
      const notice = view.locator('[data-zakat-notice]');
      await expect(notice).toHaveText(/\S{2,}/);
      if (locale === 'en') await expect(notice).toHaveText(NOTICE_EN);
      else await expect(notice).not.toHaveText(NOTICE_EN);
      await expect(notice).not.toContainText('zakat.notice');
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');

      await view.locator('[data-zakat-set]').click();
      await typeAmount(page, '[data-zakat-owed-form]', '5000');
      await page.locator('[data-zakat-owed-form] [data-save]').click();
      await expect(view.locator('[data-zakat-remaining]')).toHaveText('₹5,000');
      await view.locator('[data-zakat-add]').click();
      await typeAmount(page, '[data-zakat-log]', '1200');
      await page.locator('[data-zakat-log] input').fill('Test N.');
      await page.locator('[data-zakat-log] [data-save]').click();
      await expect(view.locator('[data-zakat-payment]')).toHaveCount(1);
      // Amounts keep "₹" and Latin digits in every language (09 §4).
      await expect(view.locator('[data-zakat-remaining]')).toHaveText('₹3,800');
      await page.waitForTimeout(600); // the sheet and the toast settle before axe reads colours
      await expectAxeClean();
      await capture('zakat');
    });
  });
}
