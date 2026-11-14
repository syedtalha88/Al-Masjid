import { APP_LOCALES, expect, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

import { ADMIN_URL, APP_URL } from '../../playwright.config.ts';
import { registerDevice } from '../support/device.ts';
import {
  HOOKS,
  label,
  registerWithInvite,
  resetRateLimits,
  seedSuperAdminInvite,
  virtualAuthenticator,
} from './helpers.ts';

// PHASE_08 T8.4 — grievances: a musalli files one from Settings → Contact & Grievance (category card, what happened,
// an e-mail only for a reply) and gets its reference `GR-YYYY-NNNNNN` with "We will acknowledge it within 24 hours";
// the Super Admin's C6 lists it with its acknowledgement timer, ★ Show contact (step-up) reveals the e-mail, then
// Acknowledge and Resolve with a note. The form in 4 locales, Urdu mirrored, axe clean. Fake texts only.

const CONTACT = 'test-grievance@example.invalid';
const TEXT = `Test grievance ${Date.now().toString(36)}`; // the stack database outlives a run

async function openForm(page: Page) {
  await page.goto(APP_URL);
  await registerDevice(page);
  await page.goto(`${APP_URL}/settings/grievance`);
  await expect(page.locator('[data-grievance-form]')).toBeVisible({ timeout: 15_000 }); // the first open after a rebuild is slow
}

test.describe('grievances (T8.4)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('a musalli files one and gets a reference; the Super Admin reveals the contact, acknowledges, resolves', async ({
    page,
    browser,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'the virtual authenticator is a Chromium DevTools feature');
    test.setTimeout(180_000);
    await resetRateLimits(page.request);

    // The musalli files it (no device or account needed).
    await openForm(page);
    const form = page.locator('[data-grievance-form]');
    const send = form.getByRole('button', { name: 'Send', exact: true });
    await expect(send).toBeDisabled();
    await form.getByText('My privacy or my data', { exact: true }).click();
    await form.getByRole('textbox', { name: /What happened/u }).fill(TEXT);
    await form.getByRole('textbox', { name: /Your e-mail or phone/u }).fill(CONTACT);
    const answer = page.waitForResponse((response) => response.url().endsWith('/api/v1/grievances'));
    await send.click();
    expect((await answer).status()).toBe(201);
    const sent = page.locator('[data-grievance-sent]');
    await expect(sent).toContainText('We will acknowledge it within 24 hours.');
    const reference = (await sent.locator('[data-grievance-ref]').textContent()) ?? '';
    expect(reference).toMatch(/^GR-\d{4}-\d{6}$/u);

    // C6: the Super Admin, on another device.
    const desk = await browser.newContext({ ignoreHTTPSErrors: true });
    const admin = await desk.newPage();
    try {
      await virtualAuthenticator(admin);
      const token = await seedSuperAdminInvite(admin.request, 'Test Owner', 'en');
      await registerWithInvite(admin, `${ADMIN_URL}/invite#${token}`, 'Test Owner', 'en');
      await admin.goto(`${ADMIN_URL}/super/grievances`);
      const card = admin.locator(`[data-grievance="${reference}"]`);
      await expect(card).toContainText(TEXT);
      await expect(card.locator('[data-due]')).toContainText('Acknowledge');
      await card.getByRole('button', { name: 'Show contact ★' }).click();
      const stepUp = admin
        .getByRole('dialog', { name: label('en', 'super', 'stepUp.title') })
        .getByRole('button', { name: label('en', 'super', 'stepUp.confirm') });
      const shown = card.locator('[data-grievance-contact]');
      await expect(stepUp.or(shown)).toBeVisible();
      if (await stepUp.isVisible()) await stepUp.click();
      await expect(shown).toHaveText(CONTACT);

      await card.getByRole('button', { name: 'Acknowledge' }).click();
      await expect(card).toContainText('Acknowledged');
      await expect(card.locator('[data-due]')).toContainText('Resolve');
      await card.getByRole('button', { name: 'Resolve', exact: true }).click();
      const dialog = admin.getByRole('dialog', { name: 'Resolve this grievance' });
      await dialog.getByRole('textbox').fill('Placeholder resolution note');
      await dialog.getByRole('button', { name: 'Resolve', exact: true }).click();
      await expect(card).toContainText('Resolved');
      await expect(card).toContainText('Placeholder resolution note');
    } finally {
      await desk.close();
    }
  });
});

for (const locale of APP_LOCALES) {
  test.describe(`grievance form (${locale})`, () => {
    test.use({ appLocale: locale });

    test('the form in this language; axe clean', async ({ page, expectAxeClean, capture }) => {
      await openForm(page);
      await expect(page.locator('[data-grievance-form]').getByRole('radio')).toHaveCount(5);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
      await expectAxeClean();
      await capture('a15-grievance-form');
    });
  });
}
