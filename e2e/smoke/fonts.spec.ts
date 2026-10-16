import { expect, test } from '@mc/config/playwright';

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

/**
 * 01 §9 font budgets (re-review V-8), bytes actually downloaded: the first-load set (everything but the lazily loaded
 * Nastaliq) ≤ 120 KB for en/ur and ≤ 180 KB for hi/te; Nastaliq on its own ≤ 350 KB.
 */
const FIRST_LOAD_BUDGET: Record<string, number> = { en: 120_000, ur: 120_000, hi: 180_000, te: 180_000 };
const NASTALIQ_BUDGET = 350_000;

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
      const sizes = new Map<string, Promise<number>>();
      page.on('request', (request) => {
        if (request.url().endsWith('.woff2')) fonts.add(request.url());
      });
      page.on('response', (response) => {
        if (response.url().endsWith('.woff2')) {
          sizes.set(
            response.url(),
            response.body().then(
              (body) => body.length,
              () => 0,
            ),
          );
        }
      });
      await page.goto(url);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.waitForLoadState('networkidle');

      const downloaded = (Object.keys(FONT) as FontName[]).filter((name) =>
        [...fonts].some((fontUrl) => FONT[name].test(fontUrl)),
      );
      expect(downloaded.sort()).toEqual([...expected].sort());

      const bytes = await Promise.all([...sizes].map(async ([fontUrl, size]) => [fontUrl, await size] as const));
      const nastaliq = bytes.filter(([fontUrl]) => FONT.nastaliq.test(fontUrl)).reduce((sum, [, n]) => sum + n, 0);
      const firstLoad = bytes.filter(([fontUrl]) => !FONT.nastaliq.test(fontUrl)).reduce((sum, [, n]) => sum + n, 0);
      expect(firstLoad, `${locale} first-load fonts (bytes)`).toBeLessThanOrEqual(FIRST_LOAD_BUDGET[locale] ?? 0);
      expect(nastaliq, 'Nastaliq (bytes)').toBeLessThanOrEqual(NASTALIQ_BUDGET);
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
