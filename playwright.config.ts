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
  // Gesture specs replay finger movements in real time (velocity decides snap vs dismiss). On a shared 4-vCPU CI
  // runner two workers distorted that timing (Sheet drag, T0.3), so CI runs one worker; locally, parallel.
  ...(process.env['CI'] ? { workers: 1 } : {}),
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
    {
      name: 'pixel-7',
      // Caddy's local CA is not trusted by the test browser; Chromium refuses service workers on certificate
      // errors even with ignoreHTTPSErrors, so the PWA specs need this flag (local/CI test browsers only).
      use: { ...devices['Pixel 7'], launchOptions: { args: ['--ignore-certificate-errors'] } },
      testIgnore: /.perf.spec.ts$/,
    },
    { name: 'iphone-14', use: { ...devices['iPhone 14'] }, testIgnore: /.perf.spec.ts$/ },
    // Performance traces (08 §8): Chromium with CPU throttling, run alone (`pnpm test:perf`, one worker) —
    // parallel workers compete for the CPU and make timings meaningless.
    { name: 'perf', use: { ...devices['Pixel 7'] }, testMatch: /.perf.spec.ts$/ },
  ],
});

export { ADMIN_URL, APP_URL };
