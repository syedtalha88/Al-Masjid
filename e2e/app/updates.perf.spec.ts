import { expect, expectSmooth, settle, test } from '@mc/config/playwright';

import { APP_URL } from '../../playwright.config.ts';
import { followByCode } from '../support/device.ts';

// PHASE_02 T2.10 acceptance / 08 §8: a fling through the Updates timeline with 4× CPU throttling — no long task over
// 50 ms, < 5 % dropped frames, no forced layout from animation frames. Runs in the `perf` project (`pnpm test:perf`).

test('Updates: fling scroll stays smooth with 4× CPU throttling', async ({ page, perfTrace }) => {
  await page.goto(APP_URL);
  await followByCode(page, APP_URL, ['TESTA001', 'TESTB002', 'TESTC003']);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Updates/ })
    .click();
  const rows = page.locator('section[data-screen]:not([inert]) li[data-key]');
  await expect(rows.nth(20)).toBeAttached();
  await settle(page);
  const scroller = page.locator('section[data-screen]:not([inert]) [data-screen-scroll]');
  const box = await scroller.boundingBox();
  if (!box) throw new Error('no scroller');
  // A native touch fling down and back up (Chromium's gesture synthesis, with momentum) — Playwright's wheel waits on
  // the page between events, which would show up in the trace as the harness's own script.
  const cdp = await page.context().newCDPSession(page);
  const fling = (yDistance: number) =>
    cdp.send('Input.synthesizeScrollGesture', {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
      yDistance,
      speed: 3000,
      gestureSourceType: 'touch',
    });

  await perfTrace.start();
  await fling(-2400);
  await fling(2400);
  await settle(page);
  expectSmooth(await perfTrace.stop());
});
