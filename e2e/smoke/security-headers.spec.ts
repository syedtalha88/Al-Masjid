import { expect, test } from '@mc/config/playwright';
import type { APIResponse } from '@playwright/test';

import { ADMIN_URL, APP_URL } from '../../playwright.config.ts';

// PHASE_00 T0.5 / 04 §7: the exact security headers on everything Caddy serves and on API responses, no inline
// script/style in the HTML (so the CSP needs no 'unsafe-inline'), and Trusted Types actually enforced. That the
// app (Motion, Tailwind, fonts, service worker) works under this CSP is proven by every other spec: the CSP
// guard fixture fails any test that causes a violation.

const COMMON = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-site',
  'x-frame-options': 'DENY',
};
const PERMISSIONS =
  'camera=(self), geolocation=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self), microphone=(), payment=(), usb=(), bluetooth=()';

/** Parses a CSP header into directive → sources. */
function csp(response: APIResponse): Map<string, string[]> {
  const header = response.headers()['content-security-policy'] ?? '';
  return new Map(
    header
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .filter((tokens) => tokens[0] !== undefined && tokens[0] !== '')
      .map(([name = '', ...sources]) => [name, sources]),
  );
}

function expectCommon(response: APIResponse) {
  const headers = response.headers();
  expect(headers).toMatchObject(COMMON);
  expect(headers['permissions-policy']?.replace(/\s/g, '')).toBe(PERMISSIONS.replace(/\s/g, ''));
  expect(headers).not.toHaveProperty('server');
  expect(headers).not.toHaveProperty('x-powered-by');
}

test.describe('static responses (Caddy)', () => {
  for (const path of ['/', '/offline.html', '/manifest.webmanifest', '/boot.js', '/deep/link']) {
    test(`app ${path}: 04 §7 headers + app CSP`, async ({ request }) => {
      const response = await request.get(`${APP_URL}${path}`);
      expect(response.status()).toBe(200);
      expectCommon(response);
      // The local stack is configured like staging: not indexable (T0.14; production sends "all").
      expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow');
      const policy = csp(response);
      expect(policy.get('default-src')).toEqual(["'self'"]);
      expect(policy.get('script-src')).toEqual(["'self'", 'https://challenges.cloudflare.com']);
      expect(policy.get('style-src')).toEqual(["'self'"]);
      expect(policy.get('frame-src')).toEqual([
        'https://challenges.cloudflare.com',
        'https://www.youtube-nocookie.com',
      ]);
      expect(policy.get('object-src')).toEqual(["'none'"]);
      expect(policy.get('base-uri')).toEqual(["'none'"]);
      expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
      expect(policy.get('require-trusted-types-for')).toEqual(["'script'"]);
      expect(policy.get('trusted-types')).toEqual(['default']);
      expect(policy.has('upgrade-insecure-requests')).toBe(true);
      expect([...policy.values()].flat()).not.toContain("'unsafe-inline'");
      expect([...policy.values()].flat()).not.toContain("'unsafe-eval'");
    });
  }

  test('app hashed asset carries the same headers', async ({ request }) => {
    const html = await (await request.get(APP_URL)).text();
    const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    expect(script).toBeDefined();
    const response = await request.get(`${APP_URL}${script ?? ''}`);
    expectCommon(response);
    expect(csp(response).get('trusted-types')).toEqual(['default']);
  });

  test('admin: same headers, no Turnstile/YouTube, noindex', async ({ request }) => {
    const response = await request.get(ADMIN_URL);
    expectCommon(response);
    expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow');
    const policy = csp(response);
    expect(policy.get('script-src')).toEqual(["'self'"]);
    expect(policy.get('frame-src')).toEqual(["'none'"]);
    expect(response.headers()['content-security-policy']).not.toMatch(/cloudflare|youtube/);
  });

  test('HTML has no inline script or style (no unsafe-inline needed)', async ({ request }) => {
    for (const url of [APP_URL, `${APP_URL}/offline.html`, ADMIN_URL, `${ADMIN_URL}/offline.html`]) {
      const html = await (await request.get(url)).text();
      expect(html, url).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
      expect(html, url).not.toMatch(/<style[\s>]/i);
      expect(html, url).not.toMatch(/\sstyle="/i);
      expect(html, url).not.toMatch(/\son[a-z]+="/i);
    }
  });
});

test.describe('API responses', () => {
  for (const url of [
    `${APP_URL}/api/v1/health`,
    `${APP_URL}/api/v1/does-not-exist`,
    `${APP_URL}/api/admin/health`, // not routed on the app origin → Caddy's own 404
    `${ADMIN_URL}/api/admin/health`,
  ]) {
    test(`${new URL(url).host}${new URL(url).pathname}: API CSP`, async ({ request }) => {
      const response = await request.get(url);
      expectCommon(response);
      expect(response.headers()['content-security-policy']?.replace(/\s/g, '')).toBe(
        "default-src'none';frame-ancestors'none'",
      );
      expect(response.headers()['cache-control']).toBe('no-store');
    });
  }
});

test('Trusted Types are enforced: an HTML sink is blocked and reported', async ({ page, cspViolations }) => {
  await page.goto(APP_URL);
  await expect(page.locator('section[data-screen]:not([inert]) h1')).toBeVisible();
  const supported = await page.evaluate(() => 'trustedTypes' in window);
  test.skip(!supported, 'this engine has no Trusted Types');
  const outcome = await page.evaluate(() => {
    const probe = document.createElement('div');
    try {
      probe.innerHTML = '<img src=x>';
      return probe.childElementCount === 0 ? 'blocked' : 'injected';
    } catch {
      return 'blocked';
    }
  });
  expect(outcome).toBe('blocked');
  await expect.poll(() => cspViolations.some((line) => /trusted-types|require-trusted-types/.test(line))).toBe(true);
  cspViolations.length = 0; // planted on purpose; any other violation still fails the test
});
