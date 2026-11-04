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

/** A day in India ("YYYY-MM-DD"), `offset` days from today. */
const istDay = (offset: number) =>
  new Date(Date.now() + 5.5 * 60 * 60 * 1000 + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

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
        // T3.3 B11: the empty list under the Ramadan card; then an entry (API) with Ramadan mode on, the entry, its
        // musalli preview, and a new entry's form.
        await adminPage.goto(`${ADMIN_URL}/special`);
        await expect(adminPage.getByText(label(locale, 'admin', 'special.emptyTitle'))).toBeVisible();
        await adminShot('b11-special-empty');
        const masjidApi = `${ADMIN_URL}/api/admin/masjids/${masjidId}`;
        const special = await adminPage.request.post(`${masjidApi}/special`, {
          headers: CSRF,
          data: {
            type: 'eid_ul_fitr',
            date: istDay(1),
            label: 'Test label',
            times: [{ time: '07:30', label: 'Test slot one' }, { time: '08:30' }],
            notify: false,
          },
        });
        expect(special.status()).toBe(201);
        const ramadan = await adminPage.request.put(`${masjidApi}/ramadan`, {
          headers: CSRF,
          data: { start: istDay(0), end: istDay(29), sehriPrecaution: 5, iftarPrecaution: 2 },
        });
        expect(ramadan.status()).toBe(200);
        await adminPage.reload();
        await expect(adminPage.locator('[data-special]')).toHaveCount(1);
        await adminPage.waitForLoadState('networkidle');
        await adminShot('b11-special');
        await adminPage.locator('[data-special]').click();
        await expect(adminPage).toHaveURL(/\/special\/[0-9a-f-]{36}$/);
        await adminPage.waitForLoadState('networkidle');
        await adminShot('b11-special-edit');
        await adminPage.getByRole('button', { name: label(locale, 'admin', 'special.preview') }).click();
        await expect(adminPage.locator('[data-preview-locale]')).toBeVisible();
        await adminPage.waitForTimeout(600); // the sheet's spring settles before the shot
        await adminShot('b11-special-preview');
        await adminPage.keyboard.press('Escape');
        await adminPage.goto(`${ADMIN_URL}/special/new`);
        await expect(
          adminPage.getByRole('heading', { name: label(locale, 'admin', 'special.newTitle') }),
        ).toBeVisible();
        await adminShot('b11-special-new');
        // T3.6 B5: the template grid; a template's Fill step with what is missing named; the filled hours; the
        // preview with the musalli card; the "Write your own" form.
        await adminPage.goto(`${ADMIN_URL}/notice`);
        const noWater = adminPage.locator('[data-template="no_water_time_range"]');
        await expect(noWater).toBeVisible();
        await adminPage.waitForLoadState('networkidle');
        await adminShot('b5-choose');
        await noWater.click();
        await expect(adminPage).toHaveURL(`${ADMIN_URL}/notice/fill`);
        const next = adminPage.getByRole('button', { name: label(locale, 'admin', 'notice.next') });
        await next.click();
        await expect(adminPage.locator('[data-notice-issues]')).toBeVisible();
        await adminShot('b5-fill-missing');
        for (const slot of [0, 1]) {
          await adminPage.locator('[data-param="hours"]').getByRole('button').nth(slot).click();
          await adminPage
            .getByRole('dialog')
            .getByRole('button', { name: label(locale, 'admin', 'timings.done') })
            .click();
          await expect(adminPage.getByRole('dialog')).toHaveCount(0);
        }
        await adminShot('b5-fill');
        await next.click();
        await expect(adminPage).toHaveURL(`${ADMIN_URL}/notice/preview`);
        await expect(adminPage.locator('[data-preview-locale]')).toBeVisible();
        await adminPage.waitForLoadState('networkidle');
        await adminShot('b5-preview');
        await adminPage.goto(`${ADMIN_URL}/notice`);
        await adminPage.locator('[data-template="own"]').click();
        await expect(adminPage).toHaveURL(`${ADMIN_URL}/notice/fill`);
        await expect(adminPage.getByRole('textbox', { name: label(locale, 'admin', 'notice.ownTitle') })).toBeVisible();
        await adminShot('b5-fill-own');
        // T3.7 B6: today's suggestion; the "Choose another" sheet; the note step; the preview (Today's hero).
        await adminPage.goto(`${ADMIN_URL}/daily`);
        await expect(adminPage.locator('[data-suggestion]')).toBeVisible();
        await adminPage.waitForLoadState('networkidle');
        await adminShot('b6-choose');
        await adminPage.getByRole('button', { name: label(locale, 'admin', 'daily.chooseAnother') }).click();
        const sheet = adminPage.getByRole('dialog');
        await expect(sheet.locator('[data-entry]').first()).toBeVisible();
        await adminPage.waitForTimeout(600); // the sheet's spring settles before the shot
        await adminShot('b6-search');
        await sheet.locator('[data-entry]').first().click();
        await expect(adminPage).toHaveURL(`${ADMIN_URL}/daily/note`);
        const dailyNote = adminPage.getByRole('textbox', {
          name: new RegExp(`^${label(locale, 'admin', 'daily.note')}`),
        });
        await dailyNote.click(); // waits for the closing sheet to release the stack (inert meanwhile)
        await dailyNote.fill('Test note from the masjid.');
        await adminShot('b6-note');
        await adminPage.getByRole('button', { name: label(locale, 'admin', 'notice.next') }).click();
        await expect(adminPage).toHaveURL(`${ADMIN_URL}/daily/preview`);
        await expect(adminPage.locator('[data-preview-locale]')).toBeVisible();
        await adminPage.waitForLoadState('networkidle');
        await adminShot('b6-preview');
        // T3.8 B7: the three category cards; an inteqal's details (janaza fields); the duas to attach; the preview.
        await adminPage.goto(`${ADMIN_URL}/dua`);
        await expect(adminPage.locator('[data-category]')).toHaveCount(3);
        await adminShot('b7-category');
        await adminPage.locator('[data-category="inteqal"]').click();
        await expect(adminPage).toHaveURL(`${ADMIN_URL}/dua/details`);
        await expect(adminPage.locator('[data-janaza]')).toBeVisible();
        await adminPage.waitForLoadState('networkidle');
        await adminShot('b7-details');
        await adminPage.getByRole('button', { name: label(locale, 'admin', 'dua.next') }).click();
        await expect(adminPage).toHaveURL(`${ADMIN_URL}/dua/attach`);
        const duaEntry = adminPage.locator('section[data-screen]:not([inert]) [data-entry]').first();
        await expect(duaEntry).toBeVisible();
        await adminShot('b7-attach');
        await duaEntry.click();
        await expect(adminPage).toHaveURL(`${ADMIN_URL}/dua/preview`);
        await expect(adminPage.locator('[data-preview-locale]')).toBeVisible();
        await adminPage.waitForLoadState('networkidle');
        await adminShot('b7-preview');
        // T3.9 B12: My Posts with a notice (API); its View sheet; the delete confirmation.
        const posted = await adminPage.request.post(`${ADMIN_URL}/api/admin/masjids/${masjidId}/items/announcement`, {
          headers: CSRF,
          data: {
            content: { kind: 'text', title: 'Test post title', body: 'Test post body', locale },
            category: 'general',
            isImportant: false,
            notify: false,
          },
        });
        expect(posted.status()).toBe(201);
        await adminPage.goto(`${ADMIN_URL}/posts`);
        const postCard = adminPage.locator('[data-post]').filter({ hasText: 'Test post title' });
        await expect(postCard).toBeVisible();
        await adminPage.waitForLoadState('networkidle');
        await adminShot('b12-posts');
        await postCard.getByRole('button', { name: label(locale, 'admin', 'posts.view') }).click();
        await expect(adminPage.getByRole('dialog')).toBeVisible();
        await adminPage.waitForTimeout(600); // the sheet's spring settles before the shot
        await adminShot('b12-view');
        await adminPage.keyboard.press('Escape');
        await expect(adminPage.getByRole('dialog')).toHaveCount(0);
        await postCard.getByRole('button', { name: label(locale, 'admin', 'posts.delete') }).click();
        await expect(adminPage.getByRole('alertdialog')).toBeVisible();
        await adminPage.waitForTimeout(400);
        await adminShot('b12-delete');
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
