import { expect, test } from '@mc/config/playwright';

import { ADMIN_URL, APP_URL } from '../../playwright.config.ts';

// 10 §3 / DECISIONS #31 through Caddy. Against the shipped image (`pnpm stack:up`) the hook routes must not
// exist; against the e2e image (`pnpm stack:up:test`, run with E2E_TEST_HOOKS=1) they must work on both APIs.

const HOOKS_EXPECTED = process.env['E2E_TEST_HOOKS'] === '1';
const CLOCKS = [`${APP_URL}/api/v1/test/clock`, `${ADMIN_URL}/api/admin/test/clock`];
// api-admin refuses unsafe requests without its Origin + CSRF header (03 §1) before routing.
const headersFor = (url: string): Record<string, string> =>
  url.startsWith(ADMIN_URL) ? { Origin: new URL(ADMIN_URL).origin, 'X-MC-CSRF': '1' } : {};

test.describe('shipped image', () => {
  test.skip(HOOKS_EXPECTED, 'running against the runtime-test stack');

  test('test-hook routes are absent (problem+json 404 on both origins)', async ({ request }) => {
    for (const url of CLOCKS) {
      const response = await request.put(url, { data: { set: '2030-01-01T00:00:00Z' }, headers: headersFor(url) });
      expect(response.status(), url).toBe(404);
      expect(response.headers()['content-type']).toContain('application/problem+json');
    }
  });
});

test.describe('runtime-test image', () => {
  test.skip(!HOOKS_EXPECTED, 'set E2E_TEST_HOOKS=1 and run `pnpm stack:up:test`');

  test('the clock hook moves server time and resets it', async ({ request }) => {
    for (const url of CLOCKS) {
      const set = await request.put(url, { data: { set: '2030-01-01T00:00:00Z' }, headers: headersFor(url) });
      expect(set.status(), url).toBe(200);
      expect(((await set.json()) as { now: string }).now.startsWith('2030-01-01T00:00')).toBe(true);
      const reset = await request.put(url, { data: { reset: true }, headers: headersFor(url) });
      expect(new Date(((await reset.json()) as { now: string }).now).getUTCFullYear()).toBeLessThan(2030);
    }
  });
});
