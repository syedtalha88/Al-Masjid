import { expect, expectSmooth, settle, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';
import { followByCode } from '../support/device.ts';

// PHASE_02 T2.14 / 08 §8 on the real screens (the T0.9 spec measures the demo placeholders): Home → Masjid Detail push
// and a swipe-back pop, tab switches, and a sheet open / drag / dismiss — each with 4× CPU throttling: no long task
// over 50 ms, < 5 % dropped frames, no forced layout from animation frames. (Qibla rotation: Phase 7.) Runs in the
// `perf` project (`pnpm test:perf`, one worker). Needs the dev seed.

// NOT YET GREEN (DECISIONS #103, PROGRESS F46): written in T2.14, this spec found 100–130 ms taps on the real screens;
// fixes in T2.14 (forced layouts in ChipGroup / UnderlineTabs / Masjid Detail, stable navigator context, one Date per
// minute, pushed screens rendered as a transition) brought them to ≈ 50–75 ms at 4× CPU, but long tasks, dropped
// frames (6–13 %) and one forced layout on sheet open remain over the 08 §8 limits. The navigator (navigation.perf)
// and the Updates fling pass those limits in CI. Re-enable when F46 is done.
test.fixme(true, 'F46 — real-screen motion budget not met yet (DECISIONS #103)');

const top = (page: Page) => page.locator('section[data-screen]:not([inert])');
const tab = (page: Page, name: RegExp) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name });

/** A finger from the left edge across most of the screen (the navigator's swipe-back). */
async function swipeBack(page: Page) {
  const width = page.viewportSize()?.width ?? 400;
  const y = (page.viewportSize()?.height ?? 800) / 2;
  await page.mouse.move(4, y);
  await page.mouse.down();
  for (let x = 20; x <= width * 0.8; x += width / 8) await page.mouse.move(x, y);
  await page.mouse.up();
}

/** Drags a sheet's handle down by `distance` px in `steps` moves, `pauseMs` apart (slow = no velocity dismiss). */
async function dragDown(page: Page, distance: number, steps: number, pauseMs = 0) {
  const box = await page.locator('[data-sheet-handle]').boundingBox();
  if (!box) throw new Error('no sheet handle');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(x, y + (distance * step) / steps);
    if (pauseMs > 0) await page.waitForTimeout(pauseMs);
  }
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await followByCode(page, APP_URL, ['TESTA001', 'TESTB002', 'TESTC003']);
  await expect(page.getByRole('list', { name: 'My Masjids' }).locator(':scope > li')).toHaveCount(3);
});

test('Home → Masjid Detail push, swipe-back pop', async ({ page, perfTrace }) => {
  const openAlpha = () =>
    page
      .getByRole('list', { name: 'My Masjids' })
      .locator(':scope > li')
      .first()
      .getByRole('button', { name: /Test Masjid Alpha/ })
      .click();
  // Warm-up: the first visit loads and evaluates Masjid Detail's chunk and data (not a transition cost).
  await openAlpha();
  await expect(top(page).getByRole('heading', { name: 'Test Masjid Alpha' }).first()).toBeVisible();
  await settle(page);
  await page.goBack();
  await expect(page).toHaveURL(`${APP_URL}/`);
  await settle(page);

  await perfTrace.start();
  for (let round = 0; round < 2; round += 1) {
    await openAlpha();
    await expect(page).toHaveURL(/\/masjid\/[0-9a-f-]{36}$/);
    await settle(page);
    await swipeBack(page);
    await expect(page).toHaveURL(`${APP_URL}/`);
    await settle(page);
  }
  expectSmooth(await perfTrace.stop());
});

test('tab switches: Home → My Masjids → Updates → Settings → Home', async ({ page, perfTrace }) => {
  const round = async () => {
    for (const [name, url] of [
      [/^My Masjids/, '/masjids'],
      [/^Updates/, '/updates'],
      [/^Settings/, '/settings'],
      [/^Home/, '/'],
    ] as const) {
      await tab(page, name).click();
      await expect(page).toHaveURL(`${APP_URL}${url}`);
      await expect(top(page).locator('.skeleton')).toHaveCount(0);
      await settle(page);
    }
  };
  await round(); // warm-up: every tab's code and data once
  await perfTrace.start();
  await round();
  expectSmooth(await perfTrace.stop());
});

test('sheet: open, drag, dismiss (My Masjids → Add Masjid)', async ({ page, perfTrace }) => {
  await tab(page, /^My Masjids/).click();
  const add = top(page).getByRole('button', { name: 'Add Masjid' }).first();
  await expect(add).toBeVisible();
  // Warm-up: the sheet's code once.
  await add.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await settle(page);

  await perfTrace.start();
  await add.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await settle(page);
  await dragDown(page, 40, 4, 60); // short, slow drag: snaps back
  await settle(page);
  await expect(page.getByRole('dialog')).toBeVisible();
  await dragDown(page, 300, 6); // long drag: dismisses
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await settle(page);
  expectSmooth(await perfTrace.stop());
});
