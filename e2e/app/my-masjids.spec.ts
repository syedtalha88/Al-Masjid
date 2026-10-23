import { expect, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';
import { followByCode, registerDevice } from '../support/device.ts';

// PHASE_02 T2.7 — A3 My Masjids (07 A3): the list (thumbs, next jamaat, "N new updates", soonest tinted); reorder
// (keyboard, menu, drag) persists across reloads; unfollow asks first, removes the server follow (network assertion)
// and Undo brings it back. Needs the dev seed (TESTA001 / TESTB002 / TESTC003).

const NAMES = ['Test Masjid Alpha', 'Test Masjid Beta', 'Test Masjid Gamma'] as const;
const rows = (page: Page) => page.getByRole('list', { name: 'My Masjids' }).locator(':scope > li');
const order = async (page: Page) =>
  (await rows(page).allInnerTexts()).map((text) => NAMES.find((name) => text.includes(name)) ?? text);

async function open(page: Page, register = false) {
  await page.goto(`${APP_URL}/masjids`);
  if (register) await registerDevice(page);
  await followByCode(page, APP_URL, ['TESTA001', 'TESTB002', 'TESTC003']);
  await expect(page.getByRole('heading', { level: 1, name: 'My Masjids' })).toBeVisible();
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).first()).toContainText('Next Prayer');
}

test('lists followed masjids with next jamaat and new-update counts', async ({ page, expectAxeClean, capture }) => {
  await open(page);
  await expect.poll(() => order(page)).toEqual([...NAMES]);
  // Followed long before the seeded items: they count as new.
  await expect(rows(page).first().locator('[data-unseen]')).toBeVisible();
  await expect(rows(page).first()).toContainText(/new updates?/);
  await expectAxeClean();
  await capture('my-masjids');
  await rows(page).first().getByRole('button').first().click();
  await expect(page).toHaveURL(/\/masjid\/[0-9a-f-]{36}$/);
});

test('reorder (keyboard on the handle, then the row menu) persists across a reload', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Edit' }).click();
  // Keyboard: Alpha down by one.
  await page.getByRole('button', { name: 'Reorder Test Masjid Alpha' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => order(page)).toEqual(['Test Masjid Beta', 'Test Masjid Alpha', 'Test Masjid Gamma']);
  await expect(page.getByRole('button', { name: 'Reorder Test Masjid Alpha' })).toBeFocused();
  // Single-tap alternative: Gamma → Move up.
  await page.getByRole('button', { name: /^Test Masjid Gamma/ }).click();
  await page.getByRole('dialog', { name: 'Test Masjid Gamma' }).getByRole('button', { name: 'Move up' }).click();
  await expect.poll(() => order(page)).toEqual(['Test Masjid Beta', 'Test Masjid Gamma', 'Test Masjid Alpha']);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await expect(rows(page)).toHaveCount(3);
  await expect.poll(() => order(page)).toEqual(['Test Masjid Beta', 'Test Masjid Gamma', 'Test Masjid Alpha']);
});

test('drag a handle to reorder', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'pointer drags are replayed with the Chromium mouse');
  await open(page);
  await page.getByRole('button', { name: 'Edit' }).click();
  const handle = page.getByRole('button', { name: 'Reorder Test Masjid Gamma' });
  const box = await handle.boundingBox();
  const first = await page.getByRole('button', { name: 'Reorder Test Masjid Alpha' }).boundingBox();
  if (!box || !first) throw new Error('no layout');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + ((first.y - box.y - 10) * step) / 10);
  }
  await page.mouse.up();
  await expect.poll(() => order(page)).toEqual(['Test Masjid Gamma', 'Test Masjid Alpha', 'Test Masjid Beta']);
});

test('unfollow asks first, removes the server follow, and Undo restores it in place', async ({ page }) => {
  await open(page, true);
  // The queued follows reach the server on start (registered device).
  await expect
    .poll(
      async () => {
        const response = await page.evaluate(async () => {
          const device = await new Promise<{ credentials: { deviceId: string; secret: string } }>((resolve) => {
            const request = indexedDB.open('mc-device');
            request.onsuccess = () => {
              const get = request.result.transaction('kv').objectStore('kv').get('device');
              get.onsuccess = () => {
                resolve(get.result as { credentials: { deviceId: string; secret: string } });
              };
            };
          });
          const answer = await fetch('/api/v1/devices/me/follows', {
            headers: { Authorization: `Device ${device.credentials.deviceId}.${device.credentials.secret}` },
          });
          return ((await answer.json()) as { follows: unknown[] }).follows.length;
        });
        return response;
      },
      { timeout: 15_000 },
    )
    .toBe(3);

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Unfollow: Test Masjid Beta' }).click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'Unfollow Test Masjid Beta?' }));
  await expect(dialog).toBeVisible();
  const removed = page.waitForRequest(
    (request) => request.method() === 'DELETE' && /\/api\/v1\/devices\/me\/follows\/[0-9a-f-]{36}$/.test(request.url()),
  );
  await dialog.getByRole('button', { name: 'Unfollow' }).click();
  expect((await (await removed).response())?.status()).toBe(204);
  await expect.poll(() => order(page)).toEqual(['Test Masjid Alpha', 'Test Masjid Gamma']);

  const restored = page.waitForRequest((request) => request.method() === 'PUT' && request.url().includes('/follows/'));
  await page.getByRole('button', { name: 'Undo' }).click();
  expect((await (await restored).response())?.status()).toBe(200);
  await expect.poll(() => order(page)).toEqual([...NAMES]);
});
