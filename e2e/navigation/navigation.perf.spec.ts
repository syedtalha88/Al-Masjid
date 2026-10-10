import { expect, type Page, test } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';

// T0.9 acceptance / 08 §8: push and pop under 4× CPU throttling never block the main thread > 50 ms.
// Runs in the `perf` project only (Chromium, one worker): `pnpm test:perf`.

const title = (page: Page) => page.locator('section[data-screen]:not([inert]) h1');
const expectTop = (page: Page, name: string) => expect(title(page)).toHaveText(name);
const openNext = (page: Page) =>
  page.locator('section[data-screen]:not([inert])').getByRole('button', { name: 'Open next screen' }).click();
async function settle(page: Page) {
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLElement>('section[data-screen]')].every(
      (element) => element.getAnimations().length === 0,
    ),
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expectTop(page, 'Masjid Connect');
});

test('push/pop with 4× CPU throttling has no long task over 50 ms', async ({ page }) => {
  // Warm-up: the first visit of a route loads and evaluates its code chunk (not a transition cost; tab
  // roots are preloaded while idle and pushed screens on press — DECISIONS #44).
  await openNext(page);
  await expectTop(page, 'Screen 2');
  await settle(page);
  await page.goBack();
  await expectTop(page, 'Masjid Connect');
  await settle(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate(() => {
    const tasks: number[] = [];
    (window as unknown as { __longTasks: number[] }).__longTasks = tasks;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push(entry.duration);
    }).observe({ type: 'longtask' });
  });
  for (let round = 0; round < 3; round += 1) {
    await openNext(page);
    await expectTop(page, 'Screen 2');
    await settle(page);
    await page.goBack();
    await expectTop(page, 'Masjid Connect');
    await settle(page);
  }
  const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
  expect(
    longTasks.filter((duration) => duration > 50),
    `long tasks (ms): ${JSON.stringify(longTasks)}`,
  ).toEqual([]);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});
