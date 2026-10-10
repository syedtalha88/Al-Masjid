import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';

// PHASE_00 T0.10 acceptance (06 §6, 08 §5.3): the component showcase in every locale — axe clean, a screenshot
// per section and locale — and the Sheet's drag, snap, dismiss, focus trap, Esc and scroll hand-off. The
// showcase exists only in dev builds: these run against a Vite dev server (E2E_DEV_APP_URL, default
// http://localhost:5173 — start it with `pnpm dev:app`); the last test checks the production build hides it.

const DEV_URL = process.env['E2E_DEV_APP_URL'] ?? 'http://localhost:5173';
const SHOWCASE = `${DEV_URL}/_dev/showcase`;
const LOCALES = ['en', 'hi', 'ur', 'te'] as const;
const SECTIONS = [
  'buttons',
  'cards',
  'tags',
  'progress',
  'skeleton',
  'tabs',
  'navbar',
  'toggles',
  'fields',
  'overlays',
  'pickers',
  'feedback',
] as const;

async function openShowcase(page: Page, locale: (typeof LOCALES)[number] = 'en') {
  await page.goto(DEV_URL);
  await page.evaluate((value) => {
    localStorage.setItem('mc.locale', value);
  }, locale);
  await page.goto(SHOWCASE);
  await expect(page.locator('[data-showcase-section="buttons"]')).toBeVisible();
}

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).exclude('[data-showcase-section="controls"]');

/** Waits until nothing animates (axe measures contrast; a mid-fade frame is not the real colors). */
const still = (page: Page) => page.waitForFunction(() => document.querySelector('[data-animating]') === null);

const violations = async (page: Page) =>
  (await axe(page).analyze()).violations.map(
    (violation) => `${violation.id}: ${violation.help} (${String(violation.nodes.length)})`,
  );

for (const locale of LOCALES) {
  test(`showcase (${locale}): axe clean, screenshot per section`, async ({ page }, info) => {
    await openShowcase(page, locale);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
    expect(await violations(page)).toEqual([]);
    for (const section of SECTIONS) {
      const element = page.locator(`[data-showcase-section="${section}"]`);
      await element.scrollIntoViewIfNeeded();
      await element.screenshot({
        path: join(info.project.outputDir, 'showcase', info.project.name, locale, `${section}.png`),
        animations: 'disabled',
        // The fixed tab bar would cover the bottom of each section.
        style: 'nav[aria-label] { visibility: hidden !important; }',
      });
    }
  });
}

test('overlays are axe clean: sheet, dialog, date picker', async ({ page }) => {
  await openShowcase(page);
  await page.getByRole('button', { name: 'Open sheet' }).click();
  await expect(page.getByRole('dialog', { name: 'Donate via UPI' })).toBeVisible();
  await still(page);
  expect(await violations(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await still(page);
  expect(await violations(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.getByRole('button', { name: '2026-09-26' }).click();
  await expect(page.getByRole('dialog', { name: 'Choose date' })).toBeVisible();
  await still(page);
  expect(await violations(page)).toEqual([]);
});

/** Vertical drag on an element's center (mouse pointer events), `steps` moves over `durationMs`. */
async function dragY(page: Page, selector: string, dy: number, durationMs: number) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const steps = 8;
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(x, y + (dy * step) / steps);
    await page.waitForTimeout(durationMs / steps);
  }
  await page.mouse.up();
}

const sheetTop = (page: Page) =>
  page.locator('[data-sheet]').evaluate((element) => Math.round(element.getBoundingClientRect().top));

/** Waits until the sheet stops moving. */
async function settled(page: Page) {
  await page.waitForFunction(() => document.querySelector('[data-sheet][data-animating]') === null);
}

test('sheet: focus moves in and is trapped; Esc closes and focus returns to the opener', async ({
  page,
  browserName,
}) => {
  await openShowcase(page);
  const opener = page.getByRole('button', { name: 'Open sheet' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Donate via UPI' });
  await expect(dialog).toBeVisible();
  await expect(page.locator(':focus')).toHaveText('Donate via UPI');
  // Tab cycles through the sheet's controls only (close, Donate Now) — never into the page behind.
  for (let press = 0; press < 5; press += 1) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => document.activeElement?.closest('dialog') !== null);
    expect(inside).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // WebKit does not focus a tapped button, so there is no opener to return to (as in the navigation spec).
  if (browserName !== 'webkit') await expect(opener).toBeFocused();
});

test('sheet: a short drag snaps back, a long drag dismisses', async ({ page }) => {
  await openShowcase(page);
  await page.getByRole('button', { name: 'Open sheet' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await settled(page);
  const open = await sheetTop(page);
  await dragY(page, '[data-sheet-handle]', 40, 400);
  await settled(page);
  expect(Math.abs((await sheetTop(page)) - open)).toBeLessThan(3);
  await dragY(page, '[data-sheet-handle]', 260, 200);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('sheet: long content snaps between content and full; dragging up past the top rubber-bands', async ({ page }) => {
  await openShowcase(page);
  await page.getByRole('button', { name: 'Open long sheet' }).click();
  await expect(page.getByRole('dialog', { name: 'Announcements' })).toBeVisible();
  await settled(page);
  const full = await sheetTop(page);
  const viewport = page.viewportSize()?.height ?? 800;
  // Content taller than 90% → the content snap is the full snap: top at 10% of the screen.
  expect(full).toBeLessThan(viewport * 0.12);
  await dragY(page, '[data-sheet-handle]', -80, 300);
  await settled(page);
  expect(Math.abs((await sheetTop(page)) - full)).toBeLessThan(3);
  // A fresh sheet for the dismiss: Playwright's emulated WebKit mouse stops delivering events in a second
  // drag after an upward one (rAF and the page keep running) — a harness quirk, not the sheet's.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open long sheet' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await settled(page);
  await dragY(page, '[data-sheet-handle]', 500, 150);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('sheet: scroll hand-off — scrolled content scrolls; at the top, pulling down drags the sheet', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'touch events are synthesized through Chromium DevTools');
  await openShowcase(page);
  await page.getByRole('button', { name: 'Open long sheet' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await settled(page);
  const content = page.locator('[data-sheet-scroll]');
  const box = await content.boundingBox();
  if (!box) throw new Error('no content box');
  const cdp = await page.context().newCDPSession(page);
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', y: number) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: box.x + box.width / 2, y }],
    });
  };
  const swipe = async (fromY: number, toY: number) => {
    await touch('touchStart', fromY);
    for (let step = 1; step <= 10; step += 1) await touch('touchMove', fromY + ((toY - fromY) * step) / 10);
    await touch('touchEnd', toY);
  };
  await content.evaluate((element) => {
    element.scrollTop = 300;
  });
  const top = await sheetTop(page);
  // Scrolled down: pulling down scrolls the list back, the sheet stays.
  await swipe(box.y + 100, box.y + 220);
  await settled(page);
  expect(Math.abs((await sheetTop(page)) - top)).toBeLessThan(3);
  expect(await content.evaluate((element) => element.scrollTop)).toBeLessThan(300);
  // At the top: pulling down far moves the sheet and dismisses it.
  await content.evaluate((element) => {
    element.scrollTop = 0;
  });
  await swipe(box.y + 60, box.y + 60 + viewportHeight(page) * 0.6);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

const viewportHeight = (page: Page) => page.viewportSize()?.height ?? 800;

test('production build: /_dev/showcase is not there (not-found screen)', async ({ page }) => {
  await page.goto(`${APP_URL}/_dev/showcase`);
  await expect(page.locator('section[data-screen]:not([inert]) h1')).toHaveText('Something went wrong');
  await expect(page.locator('[data-showcase-section]')).toHaveCount(0);
});
