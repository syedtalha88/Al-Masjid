import { readFileSync } from 'node:fs';

import { APP_LOCALES, expect, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';
import { followByCode } from '../support/device.ts';

// PHASE_05 T5.4 — A10 Donation Campaigns (07 A10, ref-3/4 + ref-2/3): the list (active → completed → closed, closed ones
// for 30 days), the detail (status pill, received "reported by masjid" vs goal, bar, last updated, meta, About), Donate
// Now hands the phone EXACTLY the expected `upi://pay` link (intercepted — a test browser has no UPI app) and, with no
// app taking it, opens the UPI QR sheet after 1.5 s; Save QR downloads the PNG; closed campaigns have no buttons; the
// "no money through us" note in all 4 languages. Needs the dev seed: TESTD004 = Test Masjid Delta (fake UPI details
// `testmasjid@okexample`, 10 §5) with its five campaigns.

const DELTA = 'TESTD004';
const RENOVATION = 'seedD0000000'; // active, ends in 21 days, ₹72,000 of ₹1,00,000
const BLANKETS = 'seedD0000003'; // closed 10 days ago
const EXPECTED_LINK =
  'upi://pay?pa=testmasjid@okexample&pn=Test%20Masjid%20Delta%20Committee&tn=Test%20Masjid%20Renovation%20Fund&cu=INR';

const screen = (page: Page) => page.locator('section[data-screen]:not([inert])');

/** Records the `upi:` links the app opens, and stops the navigation (no UPI app in a test browser). */
async function interceptUpi(page: Page) {
  await page.addInitScript(() => {
    const opened: string[] = [];
    Reflect.set(window, '__upiOpened', opened);
    document.addEventListener(
      'click',
      (event) => {
        const link = event.target instanceof Element ? event.target.closest('a') : null;
        if (link?.href.startsWith('upi:')) {
          opened.push(link.getAttribute('href') ?? '');
          event.preventDefault();
        }
      },
      true,
    );
  });
}
const upiOpened = (page: Page) => page.evaluate(() => Reflect.get(window, '__upiOpened') as string[]);

test('list: active, then completed, then closed (30 days); a card opens the detail', async ({
  page,
  expectAxeClean,
  capture,
}) => {
  await page.goto(APP_URL);
  const [delta = ''] = await followByCode(page, APP_URL, [DELTA]);
  await page.goto(`${APP_URL}/masjid/${delta}`);
  await screen(page)
    .getByRole('button', { name: /Donation Campaigns/ })
    .last()
    .click();
  await expect(screen(page).getByRole('heading', { level: 1, name: 'Donation Campaigns' })).toBeVisible();
  const cards = screen(page).getByRole('list').last().getByRole('listitem');
  await expect(cards).toHaveCount(4); // "Test old drive" closed 40 days ago is no longer listed
  // Active (newest first), completed, closed.
  await expect(cards.getByRole('button')).toHaveText([
    /Test electricity bills/,
    /Test Masjid Renovation Fund/,
    /Test roof repair/,
    /Test winter blankets/,
  ]);
  await expect(cards.first()).not.toContainText('left'); // no end date
  const first = cards.nth(1);
  await expect(first).toContainText('Active');
  await expect(first).toContainText('₹72,000 raised of ₹1,00,000');
  await expect(first).toContainText('72%');
  await expect(first).toContainText('21 days left');
  await expect(cards.nth(2)).toContainText('124%'); // completed above its goal: the real percentage
  await expect(cards.nth(3)).toContainText('Closed');
  await expectAxeClean();
  await capture('campaigns');

  await first.getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`/items/${RENOVATION}$`));
  await expect(screen(page).getByRole('heading', { name: 'Test Masjid Renovation Fund' })).toBeVisible();
});

// PHASE_05 T5.6 — donations and weekly chanda in the mixed lists: Home's recent updates and Updates say the figures
// ("… collected in the week of …", "… raised of …"), Updates offers the Donations and Chanda chips, and a chanda row
// leads to the masjid's Weekly Chanda (Delta shows its chanda in the seed).
test('Home and Updates: money lines, the Donations and Chanda chips, a chanda row opens Weekly Chanda', async ({
  page,
  expectAxeClean,
  capture,
}) => {
  await page.goto(APP_URL);
  await followByCode(page, APP_URL, [DELTA]);
  await page.goto(APP_URL);
  // Home: the newest week's entry has no words of its own — its row says the figure.
  const recent = screen(page).getByRole('region', { name: 'Recent Updates' });
  await expect(recent.getByRole('button', { name: /₹18,500 collected in the week of/ })).toBeVisible();
  await expect(recent.getByRole('button', { name: /Test electricity bills/ })).toBeVisible();

  await page.goto(`${APP_URL}/updates`);
  const chips = screen(page).getByRole('radiogroup', { name: 'Filter updates' });
  await expect(chips.getByRole('radio')).toHaveText(['All', 'Donations', 'Chanda']);
  const rows = screen(page).locator('li[data-key]');
  await expect(rows.filter({ hasText: 'Test Masjid Renovation Fund' })).toContainText('₹72,000 raised of ₹1,00,000');
  await expect(rows.filter({ hasText: /₹18,500 collected in the week of/ })).toContainText('Weekly chanda');
  await expectAxeClean();
  await capture('updates-donations');

  await chips.getByRole('radio', { name: 'Chanda' }).click();
  await expect(rows).toHaveCount(6); // six entered weeks
  await expect(rows.filter({ hasText: 'Test Masjid Renovation Fund' })).toHaveCount(0);
  await chips.getByRole('radio', { name: 'Donations' }).click();
  await expect(rows).toHaveCount(5);
  await expect(rows.filter({ hasText: 'collected in the week of' })).toHaveCount(0);

  // A chanda entry → its detail → the masjid's Weekly Chanda with the same total.
  await chips.getByRole('radio', { name: 'Chanda' }).click();
  await rows.first().getByRole('button').click();
  await screen(page).getByRole('button', { name: 'Weekly Chanda' }).click();
  await expect(page).toHaveURL(/\/masjid\/[0-9a-f-]+\/chanda$/);
  await expect(screen(page).getByText('₹18,500').first()).toBeVisible();
});

test('detail: amounts, bar, last updated, meta, About and the note', async ({ page, expectAxeClean, capture }) => {
  await page.goto(`${APP_URL}/items/${RENOVATION}`);
  const detail = screen(page);
  await expect(detail.getByRole('heading', { level: 1, name: 'Donation Campaign' })).toBeVisible();
  await expect(detail.getByText('Test Masjid Delta', { exact: true }).first()).toBeVisible(); // bar subtitle
  await expect(detail.locator('[data-status="active"]')).toHaveText('Active');
  // The count-up's screen-reader copy holds the real value from the start.
  await expect(detail.getByRole('definition').first().locator('.sr-only')).toHaveText('₹72,000');
  await expect(detail.getByRole('term').first()).toHaveText('Received (reported by masjid)');
  await expect(detail.getByText('₹1,00,000')).toBeVisible();
  await expect(detail.getByRole('progressbar', { name: 'Received so far' })).toHaveAttribute('aria-valuenow', '72');
  await expect(detail.getByText(/^Last updated .+ by masjid admin$/)).toBeVisible();
  await expect(detail.getByRole('term')).toContainText(['Started', 'Ends', 'Purpose']);
  await expect(detail.getByRole('definition').last()).toHaveText('Renovation');
  await expect(detail.getByRole('heading', { name: 'About this campaign' })).toBeVisible();
  await expect(detail.locator('[data-disclaimer]')).toHaveText(
    /^Payments go directly to the masjid’s verified UPI account\. .+ does not receive or handle any money\.$/,
  );
  await expectAxeClean();
  await capture('campaign-detail');
});

test('Donate Now opens exactly the masjid’s UPI link; no UPI app → the QR sheet', async ({
  page,
  expectAxeClean,
  capture,
}) => {
  await interceptUpi(page);
  await page.goto(`${APP_URL}/items/${RENOVATION}`);
  const detail = screen(page);
  await detail.getByRole('button', { name: 'Donate Now' }).click();
  await expect(page.locator('p', { hasText: 'Opening your UPI app…' })).toBeVisible(); // the toast
  expect(await upiOpened(page)).toEqual([EXPECTED_LINK]);

  // Nothing took the link (the page stayed in front): the QR sheet opens by itself.
  const sheet = page.getByRole('dialog', { name: 'Pay with UPI' });
  await expect(sheet).toBeVisible({ timeout: 5000 });
  await expect(sheet.getByText('Test Masjid Delta Committee', { exact: true })).toBeVisible();
  await expect(sheet.locator('[data-vpa]')).toHaveText('testmasjid@okexample');
  await expect(sheet.getByRole('img', { name: 'UPI QR code for Test Masjid Delta Committee' })).toBeVisible();
  await expect(sheet.getByText(/^Payment details changed on /)).toBeVisible(); // the seed changed them 10 days ago
  await expect(sheet.getByText('Scan with any UPI app from another phone')).toBeVisible();
  await expectAxeClean();
  await capture('upi-qr-sheet');
});

test('Show UPI QR Code → Save QR downloads the picture', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'iPhone saves through the share sheet (owner guide); the download path here');
  await page.goto(`${APP_URL}/items/${RENOVATION}`);
  await screen(page).getByRole('button', { name: 'Show UPI QR Code' }).click();
  const sheet = page.getByRole('dialog', { name: 'Pay with UPI' });
  await expect(sheet.getByRole('img', { name: /UPI QR code/ })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    sheet.getByRole('button', { name: 'Save QR to gallery' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('upi-qr-testmasjid.png');
  const png = readFileSync(await download.path());
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]); // a PNG
  await expect(page.locator('p', { hasText: 'QR code saved' })).toBeVisible(); // the toast
});

test('a closed campaign: the thank-you banner instead of the buttons', async ({ page }) => {
  await page.goto(`${APP_URL}/items/${BLANKETS}`);
  const detail = screen(page);
  await expect(detail.locator('[data-status="closed"]')).toHaveText('Closed');
  await expect(detail.locator('[data-campaign-closed]')).toContainText('This campaign has ended.');
  await expect(detail.getByRole('button', { name: 'Donate Now' })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Show UPI QR Code' })).toHaveCount(0);
  await expect(detail.locator('[data-disclaimer]')).toBeVisible();
});

const disclaimerOf = (locale: string) => {
  const content = JSON.parse(readFileSync(`packages/i18n/locales/${locale}/content.json`, 'utf8')) as {
    campaign: { disclaimer: string };
  };
  return content.campaign.disclaimer;
};

for (const locale of APP_LOCALES) {
  test.describe(locale, () => {
    test.use({ appLocale: locale });

    test(`the "no money through us" note and the detail in ${locale}`, async ({ page, expectAxeClean, capture }) => {
      await page.goto(`${APP_URL}/items/${RENOVATION}`);
      const detail = screen(page);
      const [before = '', after = ''] = disclaimerOf(locale).split('{app}');
      const note = detail.locator('[data-disclaimer]');
      await expect(note).toContainText(before.trim());
      await expect(note).toContainText(after.trim());
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
      await expect(detail.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '72');
      await expectAxeClean();
      await capture('campaign-detail');
    });
  });
}
