import { expect, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';
import { followByCode, registerDevice, storedDevice } from '../support/device.ts';

// PHASE_02 T2.12 — A15 Settings and the A16 post landing: 10 §6 journey 12 (Clear all data → the server record is
// deleted), Brother/Sister and language reach the server device record and refilter feeds, Saved, Vibration, the
// legal reader, Grievance Officer, About; `/p/:publicId` read-only with Follow. Needs the dev seed (TESTA001).

const screen = (page: Page) => page.locator('section[data-screen]:not([inert])');

async function openSettings(page: Page) {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Settings/ })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
}

/** The server's device record, read with this device's credentials. */
async function serverRecord(page: Page, credentials: { deviceId: string; secret: string }) {
  return page.request.get(`${APP_URL}/api/v1/devices/me`, {
    headers: { Authorization: `Device ${credentials.deviceId}.${credentials.secret}` },
  });
}

async function credentialsOf(page: Page): Promise<{ deviceId: string; secret: string }> {
  const credentials = (await storedDevice(page))?.['credentials'] as { deviceId: string; secret: string } | undefined;
  if (!credentials) throw new Error('device not registered');
  return credentials;
}

test('A15: the settings list, legal reader, Grievance Officer and About', async ({ page, expectAxeClean, capture }) => {
  // The local database has the migration's "NOT SET" placeholders: a fake officer (10 §5 style) for this test.
  await page.route('**/api/v1/config', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: {
        ...config,
        grievanceOfficer: {
          name: 'Test Officer',
          email: 'grievance@example.com',
          address: 'Test Road 1',
          city: 'Hyderabad',
        },
      },
    });
  });
  await page.goto(APP_URL);
  await openSettings(page);
  const list = screen(page);
  for (const row of ['Language', 'Brother / Sister', 'Saved', 'Install app', 'My data', 'Privacy Policy', 'About']) {
    await expect(list.getByRole('button', { name: new RegExp(`^${row}`) })).toBeVisible();
  }
  await expect(list.getByRole('button', { name: /^Language English/ })).toBeVisible();
  await expectAxeClean();
  await capture('settings');

  await list.getByRole('button', { name: /^Privacy Policy/ }).click();
  await expect(screen(page).getByText('DRAFT — requires legal review')).toBeVisible();
  await expect(screen(page).getByText(/We never collect your name/)).toBeVisible();
  await expectAxeClean();
  await page.goBack();

  await screen(page)
    .getByRole('button', { name: /^Contact & Grievance/ })
    .click();
  await expect(screen(page).getByText('Grievance Officer', { exact: true })).toBeVisible();
  await expect(screen(page).getByText('Test Officer')).toBeVisible();
  await expect(screen(page).getByRole('link', { name: 'Email the Grievance Officer' })).toHaveAttribute(
    'href',
    'mailto:grievance@example.com',
  );
  await expectAxeClean();
  await capture('grievance');
  await page.goBack();

  await screen(page)
    .getByRole('button', { name: /^About/ })
    .click();
  await expect(screen(page).getByText('Free forever. No ads, ever. No account. No tracking.')).toBeVisible();
  await expectAxeClean();
});

test('Brother/Sister and language reach the server device record; feeds refilter', async ({ page, browserName }) => {
  await page.goto(APP_URL);
  await registerDevice(page);
  await followByCode(page, APP_URL, ['TESTA001']);
  const credentials = await credentialsOf(page);

  // Brothers: the sisters-only notice is not in Updates.
  const sistersOnly = 'Sisters’ section open on Fridays';
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Updates/ })
    .click();
  await expect(screen(page).getByText('No water supply')).toBeVisible();
  await expect(screen(page).getByText(sistersOnly)).toHaveCount(0);

  await openSettings(page);
  await screen(page)
    .getByRole('button', { name: /^Brother \/ Sister/ })
    .click();
  await page.getByRole('dialog').locator('label').filter({ hasText: 'Sister' }).click();
  await expect
    .poll(async () => ((await (await serverRecord(page, credentials)).json()) as { audiencePref: string }).audiencePref)
    .toBe('sisters');
  expect((await storedDevice(page))?.['audiencePref']).toBe('sisters');

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Updates/ })
    .click();
  await expect(screen(page).getByText(sistersOnly)).toBeVisible();

  // Language → Urdu: mirrored at once, and the server knows (notifications in the right language, Phase 4).
  await openSettings(page);
  await screen(page)
    .getByRole('button', { name: /^Language/ })
    .click();
  await page.getByRole('dialog').locator('label').filter({ hasText: 'اردو' }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dir)).toBe('rtl');
  await expect
    .poll(async () => ((await (await serverRecord(page, credentials)).json()) as { locale: string }).locale)
    .toBe('ur');
  expect(browserName).toBeTruthy();
});

test('Saved lists bookmarked posts; Vibration is remembered (Android)', async ({ page, browserName }) => {
  await page.goto(APP_URL);
  const [masjidId = ''] = await followByCode(page, APP_URL, ['TESTA001']);
  await page.goto(`${APP_URL}/masjid/${masjidId}/hadith`);
  await screen(page).getByRole('button', { name: 'Save' }).first().click();
  await expect(screen(page).getByRole('button', { name: 'Saved' }).first()).toBeVisible();

  await page.goto(`${APP_URL}/settings`);
  await screen(page)
    .getByRole('button', { name: /^Saved/ })
    .click();
  const row = screen(page)
    .getByRole('button', { name: /Today’s Hadith|Hadith/ })
    .first();
  await expect(row).toContainText('Test Masjid Alpha');
  await row.click();
  await expect(page).toHaveURL(/\/items\/seedA/);
  await expect(screen(page).getByText('نص تجريبي للعرض فقط')).toBeVisible();

  // Vibration: Chromium has navigator.vibrate (Android); WebKit (iPhone) has none → no switch.
  await page.goto(`${APP_URL}/settings`);
  const vibration = screen(page).getByRole('switch', { name: 'Vibration' });
  if (browserName === 'webkit') {
    await expect(vibration).toHaveCount(0);
    return;
  }
  await expect(vibration).toHaveAttribute('aria-checked', 'true');
  await vibration.click();
  await expect(vibration).toHaveAttribute('aria-checked', 'false');
  await expect
    .poll(async () => ((await storedDevice(page))?.['settings'] as { vibration: boolean }).vibration)
    .toBe(false);
});

test('journey 12: Clear all data deletes the server record and returns to onboarding', async ({
  page,
  expectAxeClean,
  capture,
}) => {
  test.slow(); // WebKit on the Windows dev PC fetches one resource at a time.
  await page.goto(APP_URL);
  await registerDevice(page);
  await followByCode(page, APP_URL, ['TESTA001']);
  const credentials = await credentialsOf(page);
  expect((await serverRecord(page, credentials)).status()).toBe(200);

  await openSettings(page);
  await screen(page)
    .getByRole('button', { name: /^My data/ })
    .click();
  const data = screen(page);
  await expect(data.getByText(credentials.deviceId)).toBeVisible();
  await expect(data.getByText('Test Masjid Alpha')).toBeVisible();
  await expectAxeClean();
  await capture('my-data');

  await data.getByRole('button', { name: 'Clear all data' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Clear all data?' });
  await expect(dialog).toContainText('deletes your app ID from our server');
  await dialog.getByRole('button', { name: 'Clear all data' }).click();

  // Onboarding again (no reload: the test fixture would seed a device on the next load).
  await expect(page.getByRole('heading', { name: 'Assalamu Alaikum' })).toBeVisible();
  expect((await serverRecord(page, credentials)).status()).toBe(401);
  const device = await storedDevice(page);
  expect(device?.['credentials']).toBeUndefined();
  expect(device?.['follows'] ?? []).toEqual([]);
});

test('A16: /p/:publicId shows the post read-only with Follow masjid', async ({ page, expectAxeClean, capture }) => {
  test.slow(); // A deep link loads every chunk at once; WebKit on the Windows dev PC fetches one at a time.
  await page.goto(`${APP_URL}/p/seedA0000001`);
  const landing = screen(page);
  await expect(landing.getByRole('heading', { level: 2, name: 'Request for Dua' })).toBeVisible({ timeout: 60_000 });
  // Read-only: the count, no Ameen button.
  await expect(landing.getByRole('button', { name: 'Ameen' })).toHaveCount(0);
  await expect(landing.getByRole('button', { name: 'Follow masjid' })).toBeVisible();
  await expectAxeClean();
  await capture('post-landing');
  await landing.getByRole('button', { name: 'Follow masjid' }).click();
  await expect.poll(async () => ((await storedDevice(page))?.['follows'] as unknown[]).length).toBe(1);
});

test.describe('A16 for a first-time visitor', () => {
  test.use({ appDevice: 'fresh' });

  test('a shared post: onboarding skips "add your first masjid" and lands on the post', async ({ page }) => {
    test.slow();
    await page.goto(`${APP_URL}/p/seedA0000003`);
    await page.getByRole('button', { name: 'Get started' }).click();
    const next = page.locator('[data-page][aria-hidden="false"] section').getByRole('button').last();
    await next.click(); // language → brother/sister
    await page.locator('[data-page][aria-hidden="false"] label').first().click();
    await next.click(); // → privacy
    await next.click(); // → (install or finish)
    await expect
      .poll(
        async () => {
          if (await page.getByRole('navigation', { name: 'Main' }).isVisible()) return 'done';
          await next.click({ timeout: 3_000 }).catch(() => undefined);
          return 'onboarding';
        },
        { timeout: 30_000 },
      )
      .toBe('done');
    await expect(page).toHaveURL(/\/p\/seedA0000003$/);
    await expect(screen(page).getByRole('heading', { level: 2, name: 'Children’s weekend class' })).toBeVisible();
  });
});
