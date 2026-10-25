import { defineConfig, devices } from '@playwright/test';

import { SCAN_FEED } from './e2e/support/scan-feed.ts';

/**
 * E2E against the local compose stack (`pnpm stack:up`): Caddy at https://app.localhost:8443 and
 * https://admin.localhost:8443 (internal CA → HTTPS errors ignored locally only). Device profiles per
 * 10 §1: Pixel 7 (Chromium) and iPhone 14 (WebKit). T0.12 adds the axe, CSP, screenshot and perf fixtures.
 */
const APP_URL = process.env['E2E_APP_URL'] ?? 'https://app.localhost:8443';
const ADMIN_URL = process.env['E2E_ADMIN_URL'] ?? 'https://admin.localhost:8443';

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
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
      testIgnore: /\.(perf|scan|visual)\.spec\.ts$/,
    },
    {
      name: 'iphone-14',
      use: { ...devices['iPhone 14'] },
      testIgnore: /\.(perf|scan|visual)\.spec\.ts$/,
      // Playwright's WebKit on Windows fetches one resource at a time (~200 ms each, measured T2.7), so a screen that
      // needs a few lazy chunks takes seconds to appear locally; real Safari multiplexes over HTTP/2.
      expect: { timeout: 15_000 },
    },
    // Scan journey (10 §6 journey 2): Chromium's fake camera plays a generated QR video (e2e/support/scan-feed.ts).
    // Desktop Chromium has no native BarcodeDetector, so this also runs the WebAssembly reader (DECISIONS #94).
    {
      name: 'scan',
      use: {
        ...devices['Pixel 7'],
        permissions: ['camera'],
        launchOptions: {
          args: [
            '--ignore-certificate-errors',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${SCAN_FEED}`,
          ],
        },
      },
      testMatch: /\.scan\.spec\.ts$/,
    },
    // Performance traces (08 §8): Chromium with CPU throttling, run alone (`pnpm test:perf`, one worker) —
    // parallel workers compete for the CPU and make timings meaningless.
    // No Playwright trace here: its DOM snapshots run inside the page and would show up as long tasks in the
    // measurement (the perf fixture records its own Chrome trace).
    { name: 'perf', use: { ...devices['Pixel 7'], trace: 'off' }, testMatch: /\.perf\.spec\.ts$/ },
    // Visual baselines (T2.14): only through `pnpm test:visual` — inside the pinned Playwright Linux image, so the
    // pixels match locally and in CI (scripts/visual.mjs). One baseline folder per project and locale.
    ...(['Pixel 7', 'iPhone 14'] as const).map((device) => ({
      name: `visual-${device.toLowerCase().replace(' ', '-')}`,
      use: {
        ...devices[device],
        // Playwright injects an inline <style> for `animations: 'disabled'` / `caret: 'hide'`, which our CSP blocks
        // in WebKit. CSP stays enforced (and guarded) in every other project; here it would only fail the harness.
        bypassCSP: true,
        ...(device === 'Pixel 7' ? { launchOptions: { args: ['--ignore-certificate-errors'] } } : {}),
      },
      testMatch: /\.visual\.spec\.ts$/,
      snapshotPathTemplate: '{testDir}/visual/__screenshots__/{projectName}/{arg}{ext}',
      expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixelRatio: 0.002 } },
    })),
  ],
});

export { ADMIN_URL, APP_URL };
