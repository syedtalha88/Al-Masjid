import { expect, test } from '@playwright/test';

import { ADMIN_URL, APP_URL } from '../../playwright.config.ts';

// T0.6 acceptance (09 §6): only the active locale's fonts download, and swapping to them shifts nothing.
// Home renders Latin (brand name) + the greeting in the locale's script.

const FONT = {
  inter: /inter-latin-wght-normal/,
  devanagari: /noto-sans-devanagari/,
  telugu: /noto-sans-telugu/,
  nastaliq: /noto-nastaliq-urdu/,
  amiri: /amiri/,
} as const;
type FontName = keyof typeof FONT;

const EXPECTED: Record<string, FontName[]> = {
  en: ['inter'],
  hi: ['inter', 'devanagari'],
  te: ['inter', 'telugu'],
  ur: ['inter', 'nastaliq'],
};

for (const [locale, expected] of Object.entries(EXPECTED)) {
  for (const url of [APP_URL, ADMIN_URL]) {
    test(`${locale} on ${new URL(url).host} downloads only ${expected.join(' + ')}`, async ({ page }) => {
      await page.addInitScript((value) => {
        localStorage.setItem('mc.locale', value);
      }, locale);
      const fonts = new Set<string>();
      page.on('request', (request) => {
        if (request.url().endsWith('.woff2')) fonts.add(request.url());
      });
      await page.goto(url);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.waitForLoadState('networkidle');

      const downloaded = (Object.keys(FONT) as FontName[]).filter((name) =>
        [...fonts].some((fontUrl) => FONT[name].test(fontUrl)),
      );
      expect(downloaded.sort()).toEqual([...expected].sort());
    });
  }
}

test.describe('font swap layout shift', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Layout Instability API is Chromium-only');

  for (const locale of Object.keys(EXPECTED)) {
    test(`${locale}: CLS ≤ 0.01`, async ({ page }) => {
      await page.addInitScript((value) => {
        localStorage.setItem('mc.locale', value);
        // Collect every layout shift from the very start of the page.
        const shifts: number[] = [];
        (window as unknown as { __shifts: number[] }).__shifts = shifts;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
            if (!entry.hadRecentInput) shifts.push(entry.value);
          }
        }).observe({ type: 'layout-shift', buffered: true });
      }, locale);
      await page.goto(APP_URL);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.waitForLoadState('networkidle');
      const cls = await page.evaluate(() =>
        (window as unknown as { __shifts: number[] }).__shifts.reduce((sum, value) => sum + value, 0),
      );
      expect(cls).toBeLessThanOrEqual(0.01);
    });
  }
});
