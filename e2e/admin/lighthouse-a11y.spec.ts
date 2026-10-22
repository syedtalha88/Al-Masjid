import { expect, test } from '@mc/config/playwright';
import { chromium, devices, type Page } from '@playwright/test';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

import { ADMIN_URL } from '../../playwright.config.ts';
import {
  CSRF,
  HOOKS,
  label,
  registerWithInvite,
  resetRateLimits,
  seedSuperAdminInvite,
  virtualAuthenticator,
} from './helpers.ts';

// PHASE_01 T1.10 acceptance "Lighthouse a11y ≥ 95 on admin screens": the signed-in screens plus B1 / B2, which `pnpm lhci` cannot
// reach (it audits the signed-out login only). Sessions come from real passkey registrations (virtual authenticator);
// Lighthouse gets the session cookie as a request header. Needs the runtime-test stack (E2E_TEST_HOOKS=1).

const MIN_SCORE = 0.95;
/** Logs are public in CI: never print an invite token (the part after `#`). */
const shown = (path: string) => path.replace(/#.*/, '#…');

const sessionCookie = async (page: Page) => {
  const cookie = (await page.context().cookies(ADMIN_URL)).find((c) => c.name === '__Host-mc_sess');
  if (!cookie) throw new Error('no session cookie');
  return `${cookie.name}=${cookie.value}`;
};

test.describe('admin screens: Lighthouse accessibility (T1.10)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test(`every signed-in admin screen scores ≥ ${String(MIN_SCORE * 100)}`, async ({ page, browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'virtual authenticator + Lighthouse run on Chromium');
    test.setTimeout(240_000);
    await resetRateLimits(page.request);

    // A Super Admin with a masjid, and that masjid's admin (undertaking accepted).
    await virtualAuthenticator(page);
    const token = await seedSuperAdminInvite(page.request, 'Test Owner');
    await registerWithInvite(page, `${ADMIN_URL}/invite#${token}`, 'Test Owner');
    const masjid = await page.request.post(`${ADMIN_URL}/api/super/masjids`, {
      headers: CSRF,
      data: {
        name: 'Test Masjid Lighthouse',
        area: 'Test Area',
        city: 'Hyderabad',
        state: 'Telangana',
        address: 'Test address 1',
        lat: 17.385,
        lng: 78.4867,
      },
    });
    const { id: masjidId } = (await masjid.json()) as { id: string };
    const created = await page.request.post(`${ADMIN_URL}/api/super/admins`, {
      headers: CSRF,
      data: { displayName: 'Test Imam', uiLocale: 'en', masjidId, role: 'owner' },
    });
    const { inviteUrl } = (await created.json()) as { inviteUrl: string };
    const phone = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
    const adminPage = await phone.newPage();
    await virtualAuthenticator(adminPage);
    await registerWithInvite(adminPage, inviteUrl, 'Test Imam');
    const agree = adminPage.getByRole('checkbox', { name: label('en', 'admin', 'undertaking.agree') });
    await agree.check();
    await adminPage.getByRole('button', { name: label('en', 'admin', 'undertaking.continue') }).click();
    await expect(adminPage.getByText('Test Masjid Lighthouse').first()).toBeVisible();
    const adminCookie = await sessionCookie(adminPage);
    const superCookie = await sessionCookie(page);
    await phone.close();

    // B2: an admin who registered but has not accepted the undertaking yet; B1: an invite nobody has opened (the page
    // only reads it — it is used up by registration, not by viewing). Phase-verifier N3, 22 Oct 2026.
    const newAdmin = async (displayName: string) => {
      const response = await page.request.post(`${ADMIN_URL}/api/super/admins`, {
        headers: CSRF,
        data: { displayName, uiLocale: 'en', masjidId, role: 'editor' },
      });
      return ((await response.json()) as { inviteUrl: string }).inviteUrl;
    };
    const pendingContext = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
    const pendingPage = await pendingContext.newPage();
    await virtualAuthenticator(pendingPage);
    await registerWithInvite(pendingPage, await newAdmin('Test Editor'), 'Test Editor');
    await expect(pendingPage.getByRole('checkbox', { name: label('en', 'admin', 'undertaking.agree') })).toBeVisible();
    const pendingCookie = await sessionCookie(pendingPage);
    await pendingContext.close();
    const openInvite = new URL(await newAdmin('Test Helper'));

    const pages: readonly (readonly [string, string])[] = [
      ['/', adminCookie],
      ['/account', adminCookie],
      ['/super', superCookie],
      ['/super/masjids', superCookie],
      ['/super/masjids/new', superCookie],
      [`/super/masjids/${masjidId}`, superCookie],
      [`/super/masjids/${masjidId}/edit`, superCookie],
      ['/super/settings', superCookie],
      ['/super/audit', superCookie],
      ['/', pendingCookie], // B2 undertaking
      [`${openInvite.pathname}${openInvite.hash}`, ''], // B1 invite, signed out
    ];
    const chrome = await chromeLauncher.launch({
      chromePath: chromium.executablePath(),
      chromeFlags: [
        '--headless=new',
        '--ignore-certificate-errors',
        ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      ],
    });
    const results: string[] = [];
    try {
      for (const [path, cookie] of pages) {
        const result = await lighthouse(`${ADMIN_URL}${path}`, {
          port: chrome.port,
          logLevel: 'error',
          onlyCategories: ['accessibility'],
          ...(cookie ? { extraHeaders: { Cookie: cookie } } : {}),
        });
        const score = result?.lhr.categories['accessibility']?.score ?? 0;
        const failing = Object.values(result?.lhr.audits ?? {})
          .filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode === 'binary')
          .map((a) => a.id);
        results.push(
          `${shown(path)}: ${String(Math.round(score * 100))}${failing.length > 0 ? ` (${failing.join(', ')})` : ''}`,
        );
        expect(score, `${shown(path)} accessibility`).toBeGreaterThanOrEqual(MIN_SCORE);
      }
    } finally {
      await test.info().attach('lighthouse-a11y.txt', { body: results.join('\n'), contentType: 'text/plain' });
      process.stdout.write(`${results.join('\n')}\n`);
      chrome.kill();
    }
  });
});
