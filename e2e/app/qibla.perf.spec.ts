import { expect, expectSmooth, settle, test } from '@mc/config/playwright';

import { APP_URL } from '../../playwright.config.ts';
import { followByCode } from '../support/device.ts';

// PHASE_07 T7.3 acceptance / 08 §8 + §5.9: the Qibla dial fed by a synthetic 60 Hz absolute-orientation stream (a slow
// sweep with jitter, wrapping through North) for 3 s with 4× CPU throttling — no long task over 50 ms, < 5 % dropped
// frames, no forced layout. The heading never becomes React state; the dial's transform is written per reading.
// Runs in the `perf` project (`pnpm test:perf`).

test('Qibla: a 60 Hz sensor stream turns the dial smoothly with 4× CPU throttling', async ({ page, perfTrace }) => {
  await page.goto(APP_URL);
  await followByCode(page, APP_URL, ['TESTD004']);
  // Opened the way people open it — from a settled Home. A deep link to `/qibla` mounts Home's content underneath the
  // modal about half a second later (a one-off full layout that is not the compass's cost).
  const open = page.getByRole('button', { name: 'Qibla direction' });
  await expect(open).toBeVisible();
  await expect(page.locator('section[data-screen]:not([inert])').getByText('Test Masjid Delta').first()).toBeVisible();
  await settle(page);
  await open.click();
  await expect(page.locator('[data-qibla-dial]')).toBeVisible();
  // The compass comes alive first (a one-off re-layout as the page switches to live mode — not the stream's cost).
  await page.evaluate(() => {
    for (let n = 0; n < 3; n += 1) {
      const event = new Event('deviceorientationabsolute');
      Object.assign(event, { alpha: 40, beta: 0, gamma: 0, absolute: true });
      window.dispatchEvent(event);
    }
  });
  await expect(page.locator('[data-qibla-status]')).toHaveAttribute('data-qibla-status', 'live');
  await settle(page);

  await perfTrace.start();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let n = 0;
        const timer = setInterval(() => {
          const alpha = (360 + 40 - n * 0.6 + Math.sin(n / 3) * 2) % 360; // through North and back round
          const event = new Event('deviceorientationabsolute');
          Object.assign(event, { alpha, beta: 0, gamma: 0, absolute: true });
          window.dispatchEvent(event);
          n += 1;
          if (n >= 180) {
            clearInterval(timer);
            resolve();
          }
        }, 1000 / 60);
      }),
  );
  await settle(page);
  expectSmooth(await perfTrace.stop());
  await expect(page.locator('[data-qibla-status]')).toHaveAttribute('data-qibla-status', 'live');
});
