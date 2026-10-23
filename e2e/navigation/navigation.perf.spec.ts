import { expect, expectSmooth, settle, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';

// T0.9 acceptance / 08 §8: push and pop under 4× CPU throttling never block the main thread > 50 ms, drop
// < 5 % of frames and force no layout from animation frames; swipe release velocity (F19).
// Runs in the `perf` project only (Chromium, one worker): `pnpm test:perf`. A failure lists every long task
// with what ran inside it (input handler, chunk evaluation, animation frame…) and attaches the raw trace.

const title = (page: Page) => page.locator('section[data-screen]:not([inert]) h1');
const expectTop = (page: Page, name: string) => expect(title(page)).toHaveText(name);
const openNext = (page: Page) =>
  page.locator('section[data-screen]:not([inert])').getByRole('button', { name: 'Open next screen' }).click();

// The demo placeholders, opened over the Home root (Home is a real screen since T2.6).
test.beforeEach(async ({ page }) => {
  await page.goto(`${APP_URL}/demo/1`);
  await expectTop(page, 'Screen 1');
});

test('push/pop with 4× CPU throttling: no long task over 50 ms, smooth frames', async ({ page, perfTrace }) => {
  // Warm-up: the first visit of a route loads and evaluates its code chunk (not a transition cost; tab
  // roots are preloaded while idle and pushed screens on press — DECISIONS #44).
  await openNext(page);
  await expectTop(page, 'Screen 2');
  await settle(page);
  await page.goBack();
  await expectTop(page, 'Screen 1');
  await settle(page);
  await perfTrace.start();
  for (let round = 0; round < 3; round += 1) {
    await openNext(page);
    await expectTop(page, 'Screen 2');
    await settle(page);
    await page.goBack();
    await expectTop(page, 'Screen 1');
    await settle(page);
  }
  expectSmooth(await perfTrace.stop());
});

test('swipe-back release velocity: a short fast flick pops; flicking back towards the edge cancels', async ({
  page,
}) => {
  await openNext(page);
  await openNext(page);
  await expectTop(page, 'Screen 3');
  await settle(page);

  // Timing-sensitive, so it lives here (one worker): under parallel load Playwright's synthetic moves arrive
  // ~100 ms apart and read as a slow finger. The decision logic itself is unit-tested (navigation-gesture).
  // Few, large moves: every Playwright move costs a round trip, so many small steps would read as slow.
  const y = (page.viewportSize()?.height ?? 800) / 2;
  // About a quarter of the width in a few ms: under the distance threshold, committed by velocity alone.
  await page.mouse.move(4, y);
  await page.mouse.down();
  // Paced like a finger: a whole gesture under 10 ms reads as event noise, not a flick (DECISIONS #44).
  await page.waitForTimeout(12);
  await page.mouse.move(20, y);
  await page.waitForTimeout(12);
  await page.mouse.move(130, y);
  await page.mouse.up();
  await expectTop(page, 'Screen 2');
  await settle(page);

  // Well past 35 %, a pause, then a quick flick back towards the edge: cancelled, the screen springs back.
  await page.mouse.move(4, y);
  await page.mouse.down();
  await page.mouse.move(20, y);
  for (let x = 60; x <= 330; x += 30) await page.mouse.move(x, y);
  await page.waitForTimeout(150);
  await page.mouse.move(280, y);
  await page.mouse.move(230, y);
  await page.mouse.up();
  await settle(page);
  await expectTop(page, 'Screen 2');
  await expect(page).toHaveURL(/\/demo\/2$/);
});
