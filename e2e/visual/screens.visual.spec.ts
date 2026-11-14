import { expect, settle, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

import { ADMIN_URL, APP_URL } from '../../playwright.config.ts';
import { label, registerWithInvite, seedSuperAdminInvite, virtualAuthenticator } from '../admin/helpers.ts';
import { followByCode, gotoAfterStart } from '../support/device.ts';
import { VISUAL_NOW } from './visual-now.ts';

// PHASE_02 T2.14 — visual baselines (10 §1 "key screens × 4 locales", journey 5 "screenshots match baseline"): every
// musalli screen of this phase in en / hi / ur / te, compared pixel-wise. Deterministic by construction:
// - run only through `pnpm test:visual` — inside the pinned Playwright Linux image (the same pixels locally and in CI)
//   after the database was reset and seeded as of VISUAL_NOW (`SEED_NOW`), so items, Ramadan / Eid dates and "2 hours
//   ago" never move and no Ameen counts carry over from other specs;
// - the page clock AND the API clock (test hook) are fixed at VISUAL_NOW — server-side date windows such as the
//   bundle's "special dates from 7 days ago" follow the server clock, so a real clock let the baselines rot as the days
//   passed (DECISIONS #112) — and the API's `Date` header is dropped (the app would correct the clock);
// - no service worker, animations off, carets hidden; screenshots in CSS pixels (small files).
// Masjid photos are ThumbHash placeholders (no media server in the test stack).

test.use({ serviceWorkers: 'block' });

const API_CLOCK = `${APP_URL}/api/v1/test/clock`;
test.beforeAll(async ({ request }) => {
  const pinned = await request.put(API_CLOCK, { data: { set: VISUAL_NOW } });
  expect(pinned.status(), 'visual baselines need the test stack (`pnpm stack:up:test`) for the API clock hook').toBe(
    200,
  );
});
test.afterAll(async ({ request }) => {
  await request.put(API_CLOCK, { data: { reset: true } });
});

const LOCALES = ['en', 'hi', 'ur', 'te'] as const;

/**
 * Waits until the top screen shows its final content: requests done (counts fill in as feed pages arrive), no skeleton
 * left, fonts loaded, motion settled.
 */
async function ready(page: Page) {
  const screen = page.locator('section[data-screen]:not([inert])');
  await expect(screen.locator('h1').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(screen.locator('.skeleton')).toHaveCount(0);
  await expect(page.locator('[role="status"][aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await settle(page);
}

async function pinClock(page: Page) {
  await page.clock.setFixedTime(new Date(VISUAL_NOW));
  // The context, not the page: the app's service worker fetches API responses too, and only the context's routes
  // see those (Chromium) — a Date header through the worker would set the app back to the real time.
  await page.context().route('**/api/v1/**', async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers['date'];
    await route.fulfill({ response, headers });
  });
}

const OPTIONS = { scale: 'css', animations: 'disabled', caret: 'hide' } as const;

/** C12's answer in the visual run (fixed numbers; the hourly job is covered by stats-snapshot.int.test.ts). */
const VISUAL_STATS = {
  at: VISUAL_NOW,
  now: {
    masjids: { pending: 1, active: 4, suspended: 0, deleted: 0 },
    devices: {
      total: 120,
      platform: { android: 100, ios: 15, desktop: 4, other: 1 },
      locale: { en: 30, hi: 40, ur: 35, te: 15 },
      push: { active: 90, dead: 5, none: 25 },
    },
    follows: 260,
    push24h: { jobs: 3, sent: 180, failed: 6, successRate: 0.968 },
    queues: { waiting: 0, active: 0, delayed: 1, failed: 0, lagS: 0 },
    cloudinary: { usedPercent: 18.4, plan: 'Plus', credits: { usage: 4.6, limit: 25 } },
    sla: {
      reports: { onTime: 5, late: 0, rate: 1 },
      grievanceAck: { onTime: 2, late: 0, rate: 1 },
      grievanceResolve: { onTime: 1, late: 1, rate: 0.5 },
    },
  },
  trend: [
    { day: '2026-10-20', activeMasjids: 2, devices: 60, follows: 120, pushSent: 90, pushFailed: 2 },
    { day: '2026-10-21', activeMasjids: 3, devices: 85, follows: 180, pushSent: 140, pushFailed: 4 },
    { day: '2026-10-22', activeMasjids: 4, devices: 120, follows: 260, pushSent: 180, pushFailed: 6 },
  ],
};

const shot = async (page: Page, locale: string, name: string) => {
  await ready(page);
  await expect(page).toHaveScreenshot([locale, `${name}.png`], OPTIONS);
  // Opening Updates marks its items seen: the tab badge must be gone before the next screen, or whether the next
  // baseline shows "9+" depends on timing (Phase 08 baselines caught both states).
  if (name.endsWith('updates')) await expect(page.locator('[data-tab-button="updates"] [role="img"]')).toHaveCount(0);
};

for (const locale of LOCALES) {
  test.describe(locale, () => {
    test.use({ appLocale: locale });

    test(`musalli screens (${locale})`, async ({ page }) => {
      test.slow();
      await pinClock(page);
      await page.goto(APP_URL);
      const [alpha] = await followByCode(page, APP_URL, ['TESTA001', 'TESTB002', 'TESTC003']);
      if (alpha === undefined) throw new Error('seed masjid missing');

      await shot(page, locale, 'home');
      for (const [name, path] of [
        ['my-masjids', '/masjids'],
        ['masjid-detail', `/masjid/${alpha}`],
        ['prayer-timings', `/masjid/${alpha}/timings`],
        ['updates', '/updates'],
        ['announcements', `/masjid/${alpha}/announcements`],
        ['hadith-quran', `/masjid/${alpha}/hadith`],
        ['dua-requests', `/masjid/${alpha}/duas`],
        ['settings', '/settings'],
      ] as const) {
        await gotoAfterStart(page, `${APP_URL}${path}`);
        await shot(page, locale, name);
      }
    });

    // PHASE_05 T5.6 — donations and weekly chanda (07 A10, A11) on the seed masjid Delta, followed alone so the
    // baselines above stay as they are: Home and Updates with campaign and chanda rows (their money lines, the
    // Donations / Chanda chips), Masjid Detail with its rows (campaigns, Help the needy, chanda), the campaign list and
    // detail, Weekly Chanda, and Help the needy (T5.8).
    test(`donations and chanda (${locale})`, async ({ page }) => {
      test.slow();
      await pinClock(page);
      await page.goto(APP_URL);
      const [delta] = await followByCode(page, APP_URL, ['TESTD004']);
      if (delta === undefined) throw new Error('seed masjid Delta missing');

      await shot(page, locale, 'donations-home');
      for (const [name, path] of [
        ['donations-updates', '/updates'],
        ['donations-masjid-detail', `/masjid/${delta}`],
        ['campaigns', `/masjid/${delta}/campaigns`],
        ['campaign-detail', '/items/seedD0000000'],
        ['weekly-chanda', `/masjid/${delta}/chanda`],
        ['help-the-needy', `/masjid/${delta}/needy`], // T5.8 (07 A23): four seed people, least-funded first
      ] as const) {
        await gotoAfterStart(page, `${APP_URL}${path}`);
        await shot(page, locale, name);
      }
    });

    // PHASE_06 T6.5 (07 A12): the Bayans list (our thumbnail copies — ThumbHash here — with the play glyph and the
    // "YouTube" tag) and the player's facade before Play (no iframe, nothing from YouTube). A brothers device: one bayan.
    test(`bayans (${locale})`, async ({ page }) => {
      await pinClock(page);
      await page.goto(APP_URL);
      const [delta] = await followByCode(page, APP_URL, ['TESTD004']);
      if (delta === undefined) throw new Error('seed masjid Delta missing');
      for (const [name, path] of [
        ['bayans', `/masjid/${delta}/bayans`],
        ['bayan-player', '/items/seedD0000005'],
      ] as const) {
        await gotoAfterStart(page, `${APP_URL}${path}`);
        await shot(page, locale, name);
      }
    });

    // PHASE_07 T7.4 (07 A14): the Qibla page from Delta's location without a compass (no sensors in the visual run) —
    // the dial North-up with the Kaaba at the bearing, the bearing large and the hint; never mirrored.
    test(`qibla (${locale})`, async ({ page }) => {
      await pinClock(page);
      await page.goto(APP_URL);
      await followByCode(page, APP_URL, ['TESTD004']);
      await gotoAfterStart(page, `${APP_URL}/qibla`);
      await expect(page.locator('[data-qibla-status="none"]')).toBeVisible({ timeout: 5000 });
      await shot(page, locale, 'qibla');
    });

    // PHASE_08 T8.11: what a musalli sees of moderation and the law — the report sheet on a post ("…" → Report; not
    // sent), the grievance form and the legal readers (DRAFT texts until the owner's review — O55).
    test(`report, grievance and legal pages (${locale})`, async ({ page, browserName }) => {
      test.slow();
      await pinClock(page);
      await page.goto(APP_URL);
      await followByCode(page, APP_URL, ['TESTA001']);
      await gotoAfterStart(page, `${APP_URL}/items/seedA0000000`);
      await ready(page);
      await page.locator('section[data-screen]:not([inert]) [data-more-menu]').click();
      await page
        .getByRole('dialog', { name: label(locale, 'common', 'report.menuTitle') })
        .getByRole('button', { name: label(locale, 'common', 'report.action') })
        .click();
      await expect(page.getByRole('dialog', { name: label(locale, 'common', 'report.titlePost') })).toBeVisible();
      await settle(page);
      // WebKit's sheet is not pixel-stable yet (compare run 13 Nov 2026: 3 of 4 locales differed) — Chromium only until
      // fixed (tracked in PROGRESS, T8.11).
      if (browserName === 'chromium') await expect(page).toHaveScreenshot([locale, 'report-sheet.png'], OPTIONS);
      for (const [name, path] of [
        ['grievance-form', '/settings/grievance'],
        ['legal-privacy', '/settings/privacy'],
        ['legal-terms', '/settings/terms'],
        ['legal-content-policy', '/settings/content-policy'],
      ] as const) {
        await gotoAfterStart(page, `${APP_URL}${path}`);
        await shot(page, locale, name);
      }
    });

    // PHASE_08 T8.11: the Super Admin screens of this phase in the admin's language (Chromium only — the passkey sign-in
    // uses its virtual authenticator): C3 poster (print-sheet baselines → Phase 9, #182), C5 reports, C6 grievances, C7 legal
    // orders (empty in the fresh seed), C10 settings (kill switches, banners) and C12 stats (a fixed answer — the
    // snapshot job has integration tests).
    test(`super admin screens (${locale})`, async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'the virtual authenticator is a Chromium feature');
      test.slow();
      await virtualAuthenticator(page);
      const token = await seedSuperAdminInvite(page.request, 'Test Owner', locale);
      await registerWithInvite(page, `${ADMIN_URL}/invite#${token}`, 'Test Owner', locale);
      await page.clock.setFixedTime(new Date(VISUAL_NOW));
      await page.route('**/api/super/stats', (route) => route.fulfill({ json: VISUAL_STATS }));
      const list = (await (await page.request.get(`${ADMIN_URL}/api/super/masjids?q=TESTA001`)).json()) as {
        masjids: { id: string; followCode: string }[];
      };
      const alpha = list.masjids.find((masjid) => masjid.followCode === 'TESTA001');
      if (!alpha) throw new Error('seed masjid Alpha missing');
      for (const [name, path] of [
        ['c5-reports', '/super/reports'],
        ['c6-grievances', '/super/grievances'],
        ['c7-legal-orders', '/super/legal-orders'],
        ['c10-settings', '/super/settings'],
        ['c12-stats', '/super/stats'],
        ['c3-poster', `/super/masjids/${alpha.id}/poster`],
      ] as const) {
        await page.goto(`${ADMIN_URL}${path}`);
        await shot(page, locale, `admin-${name}`);
      }
    });

    test.describe('first launch', () => {
      test.use({ appDevice: 'fresh' });

      test(`onboarding welcome (${locale})`, async ({ page }) => {
        await pinClock(page);
        await page.goto(APP_URL);
        await expect(page.locator('h1').first()).toBeVisible();
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await settle(page);
        await expect(page).toHaveScreenshot([locale, 'onboarding-welcome.png'], OPTIONS);
      });
    });
  });
}
