import { axeViolations, expect, test } from '@mc/config/playwright';
import { devices, type Page } from '@playwright/test';

import { ADMIN_URL } from '../../playwright.config.ts';
import {
  CSRF,
  HOOKS,
  label,
  type Locale,
  registerWithInvite,
  resetRateLimits,
  seedSuperAdminInvite,
  virtualAuthenticator,
} from './helpers.ts';

// PHASE_01 T1.10 acceptance: every Phase 01 admin screen in en / hi / ur / te — screenshot + axe (WCAG 2.1 AA, no
// violation of any impact); Urdu renders right-to-left. Masjid-admin screens (B1 invite, B2 undertaking, B3 home, B13
// account) and the Super Admin screens (C1, C2 list/detail/new/edit, C10, C11). Needs the runtime-test stack
// (E2E_TEST_HOOKS=1). Fake names only (10 §Fixtures).

const LOCALES: readonly Locale[] = ['en', 'hi', 'ur', 'te'];

/** A Content Library import row — the 10 §5 placeholders only (never real religious text). */
const LIBRARY_ROW = {
  kind: 'hadith',
  arabic: 'نص تجريبي للعرض فقط',
  transliteration: { en: 'Sample transliteration — DEV ONLY' },
  translation: {
    en: 'Sample translation text for development. Not a real hadith.',
    hi: 'विकास के लिए नमूना अनुवाद। यह वास्तविक हदीस नहीं है।',
    ur: 'ترقی کے لیے نمونہ ترجمہ۔ یہ اصل حدیث نہیں ہے۔',
    te: 'అభివృద్ధి కోసం నమూనా అనువాదం. ఇది నిజమైన హదీస్ కాదు.',
  },
  source_name: 'Development fixture',
  source_license: 'N/A — not for production',
  tags: ['patience'],
};
const libraryFile = (entries: readonly object[]) =>
  Buffer.from(JSON.stringify({ format: 'masjid-connect-library', version: 1, entries }));

async function settled(page: Page, path: string): Promise<void> {
  await page.goto(`${ADMIN_URL}${path}`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  // A screen still showing its skeleton has not loaded (a failing request retries quietly) — never shoot that.
  await expect(page.locator('section[data-screen]:not([inert]) .skeleton')).toHaveCount(0);
}

for (const locale of LOCALES) {
  test.describe(`admin screens (${locale})`, () => {
    test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');
    test.use({ appLocale: locale });

    test('every screen: screenshot + axe clean', async ({ page, browser, browserName, capture, expectAxeClean }) => {
      test.skip(browserName !== 'chromium', 'the virtual authenticator is a Chromium DevTools feature');
      test.setTimeout(120_000);
      await resetRateLimits(page.request);
      const dir = locale === 'ur' ? 'rtl' : 'ltr';
      const shot = async (name: string) => {
        await expectAxeClean();
        await expect(page.locator('html')).toHaveAttribute('dir', dir);
        await capture(name);
      };

      // --- Super Admin ---
      await virtualAuthenticator(page);
      const token = await seedSuperAdminInvite(page.request, 'Test Owner', locale);
      await registerWithInvite(page, `${ADMIN_URL}/invite#${token}`, 'Test Owner', locale, async () => {
        await shot('b1-invite-super');
      });
      const masjid = await page.request.post(`${ADMIN_URL}/api/super/masjids`, {
        headers: CSRF,
        data: {
          name: `Test Masjid ${locale}`,
          area: 'Test Area',
          city: 'Hyderabad',
          state: 'Telangana',
          address: 'Test address 1',
          lat: 17.385,
          lng: 78.4867,
        },
      });
      expect(masjid.status()).toBe(201);
      const { id: masjidId } = (await masjid.json()) as { id: string };
      for (const [name, path] of [
        ['b3-home-super', '/'],
        ['c1-dashboard', '/super'],
        ['c2-masjids', '/super/masjids'],
        ['c2-masjid-new', '/super/masjids/new'],
        ['c2-masjid-detail', `/super/masjids/${masjidId}`],
        ['c2-masjid-edit', `/super/masjids/${masjidId}/edit`],
        ['c10-settings', '/super/settings'],
        ['c11-audit', '/super/audit'],
        ['b13-account-super', '/account'],
      ] as const) {
        await settled(page, path);
        await shot(name);
      }

      // --- C8 Content Library (T3.4): list → import (dry-run report, ★ import) → review → verify sheet ---
      await settled(page, '/super/library');
      await shot('c8-library');
      const reference = `DEV-SAMPLE-E2E-${locale.toUpperCase()}-${Date.now().toString(36)}`; // the stack database outlives a run
      const entry = (suffix: string) => ({ ...LIBRARY_ROW, reference: `${reference}-${suffix}` });
      await settled(page, '/super/library/import');
      await page.locator('input[type="file"]').setInputFiles({
        name: 'library.json',
        mimeType: 'application/json',
        buffer: libraryFile([entry('1'), entry('2')]),
      });
      const importAll = page.locator('section[data-screen]:not([inert])').getByRole('button', { name: /2/ });
      await expect(importAll).toBeVisible();
      await shot('c8-import-report');
      await importAll.click();
      const stepUp = page.getByRole('dialog', { name: label(locale, 'super', 'stepUp.title') });
      await stepUp.getByRole('button', { name: label(locale, 'super', 'stepUp.confirm') }).click();
      await expect(page.getByRole('button', { name: label(locale, 'super', 'library.reviewDrafts') })).toBeVisible();
      const listed = await page.request.get(`${ADMIN_URL}/api/super/library?q=${encodeURIComponent(`${reference}-1`)}`);
      const [first] = ((await listed.json()) as { entries: { id: string }[] }).entries;
      expect(first).toBeDefined();
      await settled(page, `/super/library/${first?.id ?? ''}`);
      await shot('c8-entry');
      await page.getByRole('button', { name: label(locale, 'super', 'library.verify') }).click();
      await expect(page.getByRole('textbox', { name: label(locale, 'super', 'library.verifier') })).toBeVisible();
      await shot('c8-verify');

      // --- C9 notice templates (T3.5): list, an editor with its live preview, a new template ---
      for (const [name, path] of [
        ['c9-templates', '/super/templates'],
        ['c9-template', '/super/templates/no_water_time_range'],
        ['c9-template-new', '/super/templates/new'],
      ] as const) {
        await settled(page, path);
        await shot(name);
      }

      // --- a masjid admin on their own phone ---
      const created = await page.request.post(`${ADMIN_URL}/api/super/admins`, {
        headers: CSRF,
        data: { displayName: 'Test Imam', uiLocale: locale, masjidId, role: 'owner' },
      });
      expect(created.status()).toBe(201);
      const { inviteUrl } = (await created.json()) as { inviteUrl: string };
      const phone = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
      try {
        const adminPage = await phone.newPage();
        await virtualAuthenticator(adminPage);
        const adminShot = async (name: string) => {
          expect(await axeViolations(adminPage), `axe ${name}`).toEqual([]);
          await expect(adminPage.locator('html')).toHaveAttribute('dir', dir);
          const file = await adminPage.screenshot({ path: test.info().outputPath(`screens/${locale}/${name}.png`) });
          await test.info().attach(name, { body: file, contentType: 'image/png' });
        };
        await registerWithInvite(adminPage, inviteUrl, 'Test Imam', locale, () => adminShot('b1-invite-admin'));
        await expect(
          adminPage.getByRole('heading', { name: label(locale, 'admin', 'undertaking.title') }),
        ).toBeVisible();
        await adminShot('b2-undertaking');
        await adminPage.getByRole('checkbox', { name: label(locale, 'admin', 'undertaking.agree') }).check();
        await adminPage.getByRole('button', { name: label(locale, 'admin', 'undertaking.continue') }).click();
        await expect(adminPage.getByText(`Test Masjid ${locale}`).first()).toBeVisible();
        // T3.1: the today strip of a masjid without timings asks to set them; the quota pill shows today's usage.
        await expect(adminPage.getByText(label(locale, 'admin', 'home.today.unset'))).toBeVisible();
        await expect(adminPage.getByRole('button', { name: label(locale, 'admin', 'home.today.set') })).toBeVisible();
        await adminPage.waitForLoadState('networkidle');
        await adminShot('b3-home-admin');
        // T3.2 B4: the editor of a masjid without timings, a jamaat sheet, and the musalli preview in its frame.
        await adminPage.goto(`${ADMIN_URL}/timings`);
        await expect(adminPage.getByText(label(locale, 'admin', 'timings.needAll'))).toBeVisible();
        await adminShot('b4-timings');
        const jamaat = label(locale, 'admin', 'timings.jamaat');
        await adminPage
          .locator('[data-prayer="fajr"]')
          .getByRole('button', { name: new RegExp(`^${jamaat}`) })
          .click();
        await expect(adminPage.getByRole('dialog')).toBeVisible();
        await adminPage.waitForTimeout(600); // the sheet's spring settles before the shot
        await adminShot('b4-jamaat-sheet');
        await adminPage.keyboard.press('Escape');
        await expect(adminPage.getByRole('dialog')).toHaveCount(0);
        await adminPage.getByRole('button', { name: label(locale, 'admin', 'timings.preview') }).click();
        await expect(adminPage.locator('[data-preview-locale]')).toBeVisible();
        await adminPage.waitForTimeout(600);
        await adminShot('b4-preview');
        await adminPage.keyboard.press('Escape');
        await adminPage.goto(`${ADMIN_URL}/account`);
        await adminPage.waitForLoadState('networkidle');
        await adminShot('b13-account-admin');
      } finally {
        await phone.close();
      }

      // B1 login (signed out).
      await page.request.post(`${ADMIN_URL}/api/admin/auth/logout`, { headers: CSRF });
      await settled(page, '/');
      await expect(page.getByRole('button', { name: label(locale, 'admin', 'login.button') })).toBeVisible();
      await shot('b1-login');
    });
  });
}
