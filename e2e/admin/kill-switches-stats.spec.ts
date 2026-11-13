import { expect, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

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

// PHASE_08 T8.9 / T8.10 — the Super Admin's C10 kill switches and banners, C12 Stats and C11 audit filters:
// - Settings: a maintenance banner ★ in four languages shows on the admin Home, then comes down; admin read-only mode ★
//   (confirm + step-up) shows its banner on the C1 dashboard and is turned off again. (The API side — masjid admins'
//   writes refused with READ_ONLY_MODE — is covered by kill-switches.int.test.ts.)
// - Stats renders the hourly snapshot (the API answer is fixed here; the job and route have integration tests): every
//   card, the trend's keyboard readout and its table.
// - Audit: a masjid's "Audit log" opens the log filtered to it (removable chip); every action is offered.
// Placeholder banner text only. Switches are always restored, so other specs never run in read-only mode.

const BANNER = {
  en: 'Test maintenance EN',
  hi: 'Test maintenance HI',
  ur: 'Test maintenance UR',
  te: 'Test maintenance TE',
};

const STATS = {
  at: '2026-11-13T06:05:00.000Z',
  now: {
    masjids: { pending: 2, active: 12, suspended: 1, deleted: 0 },
    devices: {
      total: 340,
      platform: { android: 300, ios: 30, desktop: 8, other: 2 },
      locale: { en: 100, hi: 120, ur: 80, te: 40 },
      push: { active: 250, dead: 10, none: 80 },
    },
    follows: 900,
    push24h: { jobs: 6, sent: 950, failed: 50, successRate: 0.95 },
    queues: { waiting: 2, active: 1, delayed: 0, failed: 0, lagS: 45 },
    cloudinary: { usedPercent: 42.5, plan: 'Plus', credits: { usage: 10.6, limit: 25 } },
    sla: {
      reports: { onTime: 9, late: 1, rate: 0.9 },
      grievanceAck: { onTime: 0, late: 0, rate: null },
      grievanceResolve: { onTime: 3, late: 1, rate: 0.75 },
    },
  },
  trend: [
    { day: '2026-11-11', activeMasjids: 10, devices: 300, follows: 800, pushSent: 700, pushFailed: 20 },
    { day: '2026-11-12', activeMasjids: 11, devices: 320, follows: 850, pushSent: 900, pushFailed: 30 },
    { day: '2026-11-13', activeMasjids: 12, devices: 340, follows: 900, pushSent: 950, pushFailed: 50 },
  ],
};

async function signInSuper(page: Page) {
  await resetRateLimits(page.request);
  await virtualAuthenticator(page);
  const token = await seedSuperAdminInvite(page.request, 'Test Owner', 'en');
  await registerWithInvite(page, `${ADMIN_URL}/invite#${token}`, 'Test Owner', 'en');
}

/** A toast's visible text (the same words are also in the screen-reader live region). */
const toast = (page: Page, text: string) => page.locator('p', { hasText: text });

/** The step-up dialog appears unless a step-up is still fresh (5 minutes). */
async function confirmStepUp(page: Page, done: ReturnType<Page['locator']>) {
  const stepUp = page
    .getByRole('dialog', { name: label('en', 'super', 'stepUp.title') })
    .getByRole('button', { name: label('en', 'super', 'stepUp.confirm') });
  await expect(stepUp.or(done)).toBeVisible();
  if (await stepUp.isVisible()) await stepUp.click();
  await expect(done).toBeVisible();
}

test.describe('kill switches, stats and audit (T8.9, T8.10)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('maintenance banner and admin read-only mode from Settings', async ({
    page,
    browserName,
    expectAxeClean,
    capture,
  }) => {
    test.skip(browserName !== 'chromium', 'virtual authenticator is a Chromium feature');
    test.setTimeout(180_000);
    await signInSuper(page);
    try {
      await page.goto(`${ADMIN_URL}/super/settings`);
      const editor = page.getByRole('region', { name: 'Maintenance banner' });
      await editor.getByRole('textbox', { name: 'English' }).fill(BANNER.en);
      await editor.getByRole('textbox', { name: 'हिन्दी' }).fill(BANNER.hi);
      await editor.getByRole('textbox', { name: 'اردو' }).fill(BANNER.ur);
      await editor.getByRole('textbox', { name: 'తెలుగు' }).fill(BANNER.te);
      // Putting a banner up is ★ (#180 M5).
      await editor.getByRole('button', { name: label('en', 'super', 'banners.show') }).click();
      await confirmStepUp(page, toast(page, label('en', 'super', 'banners.shownToast')));
      await expect(editor.getByText(label('en', 'super', 'banners.live'))).toBeVisible();
      await expectAxeClean();
      await capture('c10-banners');

      // Admin read-only mode ★: confirm, step-up; the C1 dashboard says it is on.
      await page.getByRole('switch', { name: /Admin read-only mode/u }).click();
      await page
        .getByRole('alertdialog', { name: label('en', 'super', 'readOnly.confirmTitle') })
        .getByRole('button', { name: label('en', 'super', 'readOnly.confirm') })
        .click();
      await confirmStepUp(page, toast(page, label('en', 'super', 'readOnly.onToast')));
      await page.goto(`${ADMIN_URL}/super`);
      const notice = page.locator('[data-notice-banner="warning"]');
      await expect(notice).toContainText(label('en', 'super', 'readOnly.onBanner'));
      await capture('c1-read-only');

      // The admin Home shows the maintenance banner (both apps — the musalli side reads /config).
      await page.goto(`${ADMIN_URL}/`);
      await expect(page.locator('[data-notice-banner="info"]')).toHaveText(BANNER.en);

      // Off again from the dashboard banner.
      await page.goto(`${ADMIN_URL}/super`);
      await notice.getByRole('button', { name: label('en', 'super', 'readOnly.turnOff') }).click();
      await page.getByRole('switch', { name: /Admin read-only mode/u }).click();
      await confirmStepUp(page, toast(page, label('en', 'super', 'readOnly.offToast')));

      // Take the banner down.
      await editor.getByRole('button', { name: label('en', 'super', 'banners.takeDown') }).click();
      await expect(toast(page, label('en', 'super', 'banners.removedToast'))).toBeVisible();
      await page.goto(`${ADMIN_URL}/`);
      await expect(page.locator('[data-notice-banner]')).toHaveCount(0);
    } finally {
      // Never leave a switch on for the specs that follow (the step-up above is still fresh).
      await page.request.post(`${ADMIN_URL}/api/super/settings/read-only`, {
        data: { readOnly: false },
        headers: CSRF,
      });
      await page.request.patch(`${ADMIN_URL}/api/super/settings`, { data: { maintenanceBanner: null }, headers: CSRF });
    }
  });

  test('Stats renders the snapshot; Audit filters by masjid', async ({
    page,
    browserName,
    expectAxeClean,
    capture,
  }) => {
    test.skip(browserName !== 'chromium', 'virtual authenticator is a Chromium feature');
    test.setTimeout(120_000);
    await signInSuper(page);
    await page.route('**/api/super/stats', (route) => route.fulfill({ json: STATS }));

    await page.goto(`${ADMIN_URL}/super/stats`);
    await expect(page.getByRole('heading', { name: 'Stats' }).first()).toBeVisible();
    await expect(page.getByText('340 phones')).toBeVisible();
    await expect(page.getByText('95% delivered')).toBeVisible();
    await expect(page.getByText('90% · 9 on time, 1 late')).toBeVisible();
    await expect(page.getByText(label('en', 'super', 'stats.noneYet'))).toBeVisible();
    await expect(page.getByText('Oldest waiting job: 45 seconds')).toBeVisible();
    await expect(page.getByText('43% used')).toBeVisible();
    const phones = page.getByRole('img', { name: 'Phones', exact: true });
    await phones.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('figure', { has: phones }).locator('figcaption')).toContainText('320');
    await expect(page.getByRole('table', { name: /Phones — Daily values/u })).toBeAttached();
    await expectAxeClean();
    await capture('c12-stats');

    // C11: a masjid's "Audit log" → the log filtered to it, a removable chip; every action offered.
    const list = (await (await page.request.get(`${ADMIN_URL}/api/super/masjids?q=TESTA001`)).json()) as {
      masjids: { id: string; followCode: string }[];
    };
    const alpha = list.masjids.find((masjid) => masjid.followCode === 'TESTA001');
    if (!alpha) throw new Error('seed masjid Alpha missing');
    await page.goto(`${ADMIN_URL}/super/masjids/${alpha.id}`);
    await page.getByRole('button', { name: label('en', 'super', 'detail.audit') }).click();
    await expect(page).toHaveURL(new RegExp(`/super/audit\\?masjid=${alpha.id}`, 'u'));
    const chip = page.getByRole('button', { name: `Remove filter: Masjid ${alpha.id.slice(0, 8)}` });
    await expect(chip).toBeVisible();
    await page.getByRole('button', { name: /^Action/u }).click();
    await expect(page.getByRole('dialog').getByText('settings.read_only_on', { exact: true })).toBeAttached();
    await page.keyboard.press('Escape');
    await expectAxeClean();
    await capture('c11-audit-filtered');
    await chip.click();
    await expect(page).toHaveURL(/\/super\/audit$/u);
  });
});
