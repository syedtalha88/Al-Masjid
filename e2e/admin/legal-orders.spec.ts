import { expect, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

import { ADMIN_URL } from '../../playwright.config.ts';
import {
  HOOKS,
  label,
  registerWithInvite,
  resetRateLimits,
  seedSuperAdminInvite,
  virtualAuthenticator,
} from './helpers.ts';

// PHASE_08 T8.5 — the legal orders register (C7): the Super Admin ★ records an order (received time in India time,
// a masjid by its follow code), sees the 3-hour timer on the card and on the C1 Deadlines card, ★ attaches a PDF
// (stored encrypted), ★ downloads it back byte for byte, and ★ marks it acted on with a note — the clock stops and
// the log shows each step. Axe clean. Fake texts only.

const REF = `TEST/E2E/${Date.now().toString(36)}`; // the stack database outlives a run
const PDF = Buffer.from(`%PDF-1.4\nTest legal order document ${REF}\n%%EOF\n`);

/** Confirms the step-up dialog when it appears (the session may still be inside its 5-minute window). */
async function confirmStepUp(page: Page, done: ReturnType<Page['locator']>) {
  const stepUp = page
    .getByRole('dialog', { name: label('en', 'super', 'stepUp.title') })
    .getByRole('button', { name: label('en', 'super', 'stepUp.confirm') });
  await expect(stepUp.or(done)).toBeVisible();
  if (await stepUp.isVisible()) await stepUp.click();
}

test.describe('legal orders (T8.5)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('record → timer on C7 and C1 → attach and download the document → acted on', async ({
    page,
    browserName,
    expectAxeClean,
    capture,
  }) => {
    test.skip(browserName !== 'chromium', 'the virtual authenticator is a Chromium DevTools feature');
    test.setTimeout(180_000);
    await resetRateLimits(page.request);
    await virtualAuthenticator(page);
    const token = await seedSuperAdminInvite(page.request, 'Test Owner', 'en');
    await registerWithInvite(page, `${ADMIN_URL}/invite#${token}`, 'Test Owner', 'en');

    await page.goto(`${ADMIN_URL}/super/legal-orders`);
    await page.getByRole('button', { name: 'Record an order ★' }).click();
    const form = page.getByRole('dialog', { name: 'New legal order' });
    await form.getByRole('textbox', { name: 'Authority' }).fill('Test Authority');
    await form.getByRole('textbox', { name: 'Order reference number' }).fill(REF);
    await form.getByRole('button', { name: /What does it name/u }).click();
    await page.getByRole('radio', { name: 'A masjid' }).click();
    await expect(page.getByRole('radio', { name: 'A masjid' })).toBeHidden(); // the picker sheet has closed
    const which = form.getByRole('textbox', { name: 'Which one' });
    await which.fill('TESTA001');
    await expect(which).toHaveValue('TESTA001');
    const asks = form.getByRole('textbox', { name: 'What the order asks' });
    await asks.fill('Test order summary');
    await expect(asks).toHaveValue('Test order summary');
    await form.getByRole('button', { name: 'Save ★' }).click();
    const card = page.locator(`[data-legal-order="${REF}"]`);
    await confirmStepUp(page, card);
    await expect(card).toContainText('Received');
    await expect(card.locator('[data-due]')).toContainText('Act');
    await expectAxeClean();
    await capture('c7-legal-orders');

    // C1: the timer is on the Deadlines card and leads back here.
    await page.goto(`${ADMIN_URL}/super`);
    await expect(page.locator('[data-sla-card]')).toContainText('Legal order — act');

    // ★ Attach the document, then ★ download it: the same bytes come back.
    await page.goto(`${ADMIN_URL}/super/legal-orders`);
    const chooser = page.waitForEvent('filechooser');
    await card.getByRole('button', { name: 'Attach document ★' }).click();
    await (await chooser).setFiles({ name: 'order.pdf', mimeType: 'application/pdf', buffer: PDF });
    await confirmStepUp(page, card.getByText('Document attached'));
    await expect(card).toContainText('Document attached');
    const download = page.waitForEvent('download');
    await card.getByRole('button', { name: 'Download document ★' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^legal-order-TEST-E2E-[a-z0-9]+\.pdf$/u);
    const path = await file.path();
    const { readFile } = await import('node:fs/promises');
    expect((await readFile(path)).equals(PDF)).toBe(true);

    // ★ Acted on, with a note: the clock stops; the log shows every step.
    await card.getByRole('button', { name: 'Update ★' }).click();
    const update = page.getByRole('dialog', { name: 'Update the order' });
    await update.getByRole('button', { name: /Status/u }).click();
    await page.getByRole('radio', { name: 'Acted on' }).click();
    await expect(page.getByRole('radio', { name: 'Acted on' })).toBeHidden();
    await update.getByRole('textbox', { name: /Note for the log/u }).fill('Placeholder note');
    await update.getByRole('button', { name: 'Save ★' }).click();
    await confirmStepUp(page, card.getByText('Acted on'));
    await expect(card.locator('[data-due]')).toHaveCount(0);
    await expect(card.locator('[data-legal-log]')).toContainText('Order recorded');
    await expect(card.locator('[data-legal-log]')).toContainText('Document uploaded');
    await expect(card.locator('[data-legal-log]')).toContainText('Status: received → actioned');
    await expect(card.locator('[data-legal-log]')).toContainText('Placeholder note');
  });
});
