import { expect, test } from '@mc/config/playwright';

import { ADMIN_URL, APP_URL } from '../../playwright.config.ts';

// PHASE_00 T0.13 acceptance: production builds serve no source maps, and without a Sentry DSN the browser never
// downloads the error-reporting code (DECISIONS #35, #52).

for (const [name, url] of [
  ['app', APP_URL],
  ['admin', ADMIN_URL],
] as const) {
  test(`${name}: the source map of a live bundle is not served`, async ({ request }) => {
    const html = await (await request.get(url)).text();
    const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    expect(script).toBeDefined();
    const bundle = await request.get(`${url}${script ?? ''}`);
    expect(bundle.status()).toBe(200);
    expect(await bundle.text()).not.toContain('sourceMappingURL=');
    expect((await request.get(`${url}${script ?? ''}.map`)).status()).toBe(404);
  });

  test(`${name}: no DSN → the Sentry chunk is never downloaded`, async ({ page }) => {
    const scripts: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname);
    });
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 2500))); // past the idle fallback
    expect(scripts.some((path) => /\/assets\/sentry-[\w-]+\.js$/.test(path))).toBe(false);
  });
}
