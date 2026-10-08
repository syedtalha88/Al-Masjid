import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against the local compose stack (`pnpm stack:up`): Caddy at https://app.localhost:8443 and
 * https://admin.localhost:8443 (internal CA → HTTPS errors ignored locally only). Device profiles per
 * 10 §1: Pixel 7 (Chromium) and iPhone 14 (WebKit). T0.12 adds the axe, CSP, screenshot and perf fixtures.
 */
const APP_URL = process.env['E2E_APP_URL'] ?? 'https://app.localhost:8443';
const ADMIN_URL = process.env['E2E_ADMIN_URL'] ?? 'https://admin.localhost:8443';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    ignoreHTTPSErrors: true,
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  metadata: { appUrl: APP_URL, adminUrl: ADMIN_URL },
  projects: [
    { name: 'pixel-7', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-14', use: { ...devices['iPhone 14'] } },
  ],
});

export { ADMIN_URL, APP_URL };
