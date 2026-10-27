import { expect, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';
import { storedDevice } from '../support/device.ts';

// PHASE_02 T2.4 — A1 onboarding (07 A1, 10 §6 journey 1 up to Home): welcome → language (live switch, Urdu RTL) →
// brother/sister → privacy (registers the device with Turnstile — Cloudflare's test key locally) → first masjid →
// install; arriving via /m/:code skips page 5 and follows that masjid; offline at "Continue" the app goes on and
// registers when back online. Needs the dev seed (TESTA001).

test.use({ appDevice: 'fresh' });

const LOCALES = [
  { code: 'en', native: 'English', dir: 'ltr', start: 'Get started' },
  { code: 'hi', native: 'हिन्दी', dir: 'ltr', start: 'शुरू करें' },
  { code: 'ur', native: 'اردو', dir: 'rtl', start: 'شروع کریں' },
  { code: 'te', native: 'తెలుగు', dir: 'ltr', start: 'ప్రారంభించండి' },
] as const;

/** Taps the primary action at the bottom of the current page. */
const next = (page: Page) => page.locator('[data-page][aria-hidden="false"] section').getByRole('button').last();

async function throughPrivacy(page: Page, locale: (typeof LOCALES)[number]) {
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.locator('label').filter({ hasText: locale.native }).click();
  await expect(page.getByRole('radio', { name: locale.native })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('lang', locale.code);
  await expect(page.locator('html')).toHaveAttribute('dir', locale.dir);
  await next(page).click(); // → brother / sister
  const continueButton = next(page);
  await expect(continueButton).toBeDisabled(); // a choice is required
  await page.locator('[data-page][aria-hidden="false"] label').first().click();
  await continueButton.click(); // → privacy
}

async function finishRemaining(page: Page) {
  // Page 5 (when shown): "Later"; install (when shown): its last action — until the tab bar appears.
  const nav = page.getByRole('navigation');
  for (let step = 0; step < 6; step += 1) {
    await expect(nav.or(next(page))).toBeVisible();
    if (await nav.isVisible()) return;
    // The last page may finish (and unmount) between the check and the click: then the loop sees the tab bar.
    await next(page)
      .click({ timeout: 3_000 })
      .catch(() => undefined);
  }
  await expect(nav).toBeVisible();
}

for (const locale of LOCALES) {
  test(`journey 1 (${locale.code}): onboarding registers the device and lands on Home`, async ({
    page,
    expectAxeClean,
  }) => {
    await page.goto(APP_URL);
    await expect(page.getByRole('heading', { name: 'Assalamu Alaikum' })).toBeVisible();
    await expectAxeClean();
    await throughPrivacy(page, locale);
    const registered = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/devices') && response.request().method() === 'POST',
    );
    await next(page).click(); // privacy → Continue
    expect((await registered).status()).toBe(201);
    await expectAxeClean();
    await finishRemaining(page);
    await expect(page.getByRole('navigation')).toBeVisible();
    const device = await storedDevice(page);
    expect(device).toMatchObject({ locale: locale.code, audiencePref: 'brothers', privacyVersion: 'draft-1' });
    expect(device?.['credentials']).toMatchObject({ deviceId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(typeof device?.['onboardedAt']).toBe('string');
    // A reload goes straight to Home.
    await page.reload();
    await expect(page.getByRole('navigation')).toBeVisible();
  });
}

for (const locale of LOCALES) {
  test(`journey 1 via /m/:code (${locale.code}): skips "add your first masjid", follows it, Home counts down`, async ({
    page,
    browserName,
  }) => {
    await followLinkJourney(page, browserName, locale);
  });
}

async function followLinkJourney(page: Page, browserName: string, locale: (typeof LOCALES)[number]) {
  await page.goto(`${APP_URL}/m/TESTA001`);
  if (browserName === 'webkit') {
    // iPhone Safari: the "follow it in the app" explainer comes first (DECISIONS #14); go on here instead.
    // WebKit on a busy runner: the landing chunk, its strings and the lookup can take a few seconds.
    await expect(page.getByText('TEST-A001')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Use it here in Safari instead' }).click();
    await page.getByRole('button', { name: 'Follow masjid' }).click();
  }
  await throughPrivacy(page, locale);
  await next(page).click(); // privacy → Continue
  await expect(page.getByRole('heading', { name: 'Add your first masjid' })).toHaveCount(0);
  const followed = page.waitForResponse(
    (response) =>
      /\/api\/v1\/devices\/me\/follows\/[0-9a-f-]{36}$/.test(response.url()) && response.request().method() === 'PUT',
  );
  await finishRemaining(page);
  expect((await followed).status()).toBe(200);
  if (locale.code === 'en') {
    await expect(page.getByRole('status').filter({ hasText: 'You now follow' })).toHaveText(
      'You now follow Test Masjid Alpha.',
    );
  }
  expect(new URL(page.url()).pathname).toBe('/');
  const device = await storedDevice(page);
  expect(device?.['follows']).toEqual([expect.objectContaining({ sync: 'synced' })]);
  // Home shows the followed masjid with the next jamaat's live countdown (its rolling digits) — in every locale.
  const home = page.locator('section[data-screen]:not([inert])');
  await expect(home.locator('[data-digits]').first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', locale.code);
}

test('offline at "Continue": onboarding goes on and the device registers once back online', async ({
  page,
  context,
}) => {
  await page.goto(APP_URL);
  await throughPrivacy(page, LOCALES[0]);
  await context.setOffline(true);
  await next(page).click(); // privacy → Continue (registration deferred)
  await expect(
    page
      .locator('[data-page][aria-hidden="false"]')
      .getByText('You’re offline. The app will finish setting up when you’re back online.'),
  ).toBeVisible();
  await finishRemaining(page);
  await expect(page.getByRole('navigation')).toBeVisible();
  expect((await storedDevice(page))?.['registrationPending']).toBe(true);
  const registered = page.waitForResponse((response) => response.url().endsWith('/api/v1/devices'));
  await context.setOffline(false);
  expect((await registered).status()).toBe(201);
  await expect.poll(async () => (await storedDevice(page))?.['credentials']).toBeTruthy();
  expect((await storedDevice(page))?.['registrationPending']).toBe(false);
});
