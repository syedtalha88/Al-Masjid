import { expect, test } from '@mc/config/playwright';

import { ADMIN_URL, APP_URL } from '../../playwright.config.ts';

// T0.4 smoke: both PWAs load through Caddy, the SPA fallback works, and each origin proxies only its own
// API. Copy assertions use BRAND-derived text until i18n lands (T0.7).

test.describe('musalli app (app origin)', () => {
  test('loads the app shell', async ({ page }) => {
    const response = await page.goto(APP_URL);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('Masjid Connect');
    await expect(page.getByRole('heading', { level: 1, name: 'Assalamu Alaikum' })).toBeVisible();
  });

  test('unknown client route falls back to the SPA', async ({ page }) => {
    const response = await page.goto(`${APP_URL}/some/deep/link`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('#root')).toBeAttached();
  });

  test('public API health through Caddy; admin API is not served here', async ({ request }) => {
    const health = await request.get(`${APP_URL}/api/v1/health`);
    expect(health.status()).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, service: 'api-public', db: 'ok', redis: 'ok' });

    const admin = await request.get(`${APP_URL}/api/admin/health`);
    expect(admin.status()).toBe(404);
    expect(admin.headers()['content-type']).toContain('application/problem+json');
  });

  test('unknown API route → problem+json 404, never the SPA', async ({ request }) => {
    const response = await request.get(`${APP_URL}/api/v1/does-not-exist`);
    expect(response.status()).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  test('unknown hashed asset → uncacheable 404, never the app shell (review S-L6)', async ({ request }) => {
    for (const url of [APP_URL, ADMIN_URL]) {
      const response = await request.get(`${url}/assets/does-not-exist-0000.js`);
      expect(response.status(), url).toBe(404);
      expect(response.headers()['cache-control'], url).toBe('no-store');
      expect(await response.text(), url).not.toContain('<div id="root"');
    }
  });

  test('Caddy sets the request id; a client-supplied one is replaced (review S-L11)', async ({ request }) => {
    const spoofed = 'client-chosen-request-id-0001';
    const response = await request.get(`${APP_URL}/api/v1/health`, { headers: { 'X-Request-Id': spoofed } });
    expect(response.status()).toBe(200);
    expect(response.headers()['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers()['x-request-id']).not.toBe(spoofed);
  });
});

test.describe('locale boot (T0.7, 09 §5)', () => {
  for (const url of [APP_URL, ADMIN_URL]) {
    test(`stored Urdu choice → <html lang=ur dir=rtl> before the app renders (${new URL(url).hostname})`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        localStorage.setItem('mc.locale', 'ur');
      });
      await page.goto(url);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('html')).toHaveAttribute('lang', 'ur');
      // Still renders (the shell heading is the brand name in every locale).
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });
  }

  test('/boot.js is an external, revalidated classic script (no inline JS for the CSP)', async ({ request }) => {
    const response = await request.get(`${APP_URL}/boot.js`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('javascript');
    expect(response.headers()['cache-control']).toBe('no-cache');
    expect(await response.text()).toContain('"mc.locale"');
  });
});

test.describe('admin app (admin origin)', () => {
  test('loads the admin shell, noindex — signed out it shows the passkey login (PHASE_01 T1.10)', async ({ page }) => {
    const response = await page.goto(ADMIN_URL);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow');
    await expect(page).toHaveTitle('Masjid Connect Admin');
    await expect(page.getByRole('heading', { level: 1, name: 'Masjid Admin' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });

  test('admin API health through Caddy; public API is not served here', async ({ request }) => {
    const health = await request.get(`${ADMIN_URL}/api/admin/health`);
    expect(health.status()).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, service: 'api-admin', db: 'ok', redis: 'ok' });
    expect((await request.get(`${ADMIN_URL}/api/v1/health`)).status()).toBe(404);
  });
});
