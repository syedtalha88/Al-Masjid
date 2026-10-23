import { expect, settle, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';

// T0.9 acceptance (08 §3): stack push/pop, Android/browser back, swipe-back, tabs keep their stacks,
// re-tap pops to root + scrolls top, modal, focus management, inert covered screens, stress and perf. The stack is
// exercised with the `/demo/:n` placeholder screens (opened as a deep link over the Home root, so their numbers stay
// 1, 2, 3…); Home is the real screen since T2.5, so root-scrolling uses the long Settings tab.

const title = (page: Page) => page.locator('section[data-screen]:not([inert]) h1');
const expectTop = async (page: Page, name: string) => {
  await expect(title(page)).toHaveText(name);
  // Exactly one interactive screen; every other screen is inert and hidden from assistive tech.
  await expect(page.locator('section[data-screen]:not([inert])')).toHaveCount(1);
};
const openNext = (page: Page) =>
  page.locator('section[data-screen]:not([inert])').getByRole('button', { name: 'Open next screen' }).click();
/** Pushes via a DOM click, so Playwright does not scroll the button into view first. */
const openNextInPlace = (page: Page) =>
  page
    .locator('section[data-screen]:not([inert])')
    .getByRole('button', { name: 'Open next screen' })
    .evaluate((button: HTMLElement) => {
      button.click();
    });
const scroller = (page: Page) => page.locator('section[data-screen]:not([inert]) [data-screen-scroll]');
const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name });

/** Drags like a finger: `steps` moves spread over `durationMs` (instant synthetic moves look like a flick). */
async function drag(page: Page, fromX: number, toX: number, durationMs: number) {
  const y = (page.viewportSize()?.height ?? 800) / 2;
  const steps = 10;
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(fromX + ((toX - fromX) * step) / steps, y);
    await page.waitForTimeout(durationMs / steps);
  }
  await page.mouse.up();
}

const HOME = 'Assalamu Alaikum';

test.beforeEach(async ({ page }) => {
  await page.goto(`${APP_URL}/demo/1`);
  await expectTop(page, 'Screen 1');
});

test('push and back: new screen on top, focus on its title, previous screen inert and restored', async ({ page }) => {
  // Whether a click focuses the button differs by engine and platform (Chromium and Linux WebKit do, WebKit on
  // macOS/Windows/iOS does not), so record it instead of assuming it from the browser name.
  await page.evaluate(() => {
    const trail: string[] = [];
    (window as unknown as { __focusTrail: string[] }).__focusTrail = trail; // test-only global
    document.addEventListener('focusin', (event) => {
      trail.push((event.target as HTMLElement).textContent); // focusin targets are elements
    });
  });
  await openNext(page);
  await expectTop(page, 'Screen 2');
  await settle(page);
  await expect(page.locator(':focus')).toHaveText('Screen 2');
  await expect(page).toHaveURL(/\/demo\/2$/);
  // Covered: Screen 1 and the Home root under the deep link.
  await expect(page.locator('section[data-screen][inert]')).toHaveCount(2);

  await page.locator('section[data-screen]:not([inert])').getByRole('button', { name: 'Back' }).click();
  await expectTop(page, 'Screen 1');
  await settle(page);
  // Focus returns to the control that opened the screen if it had focus; otherwise to the title (DECISIONS #44).
  const trail = await page.evaluate(() => (window as unknown as { __focusTrail: string[] }).__focusTrail);
  const openerHadFocus = trail.includes('Open next screen');
  await expect(page.locator(':focus')).toHaveText(openerHadFocus ? 'Open next screen' : 'Screen 1');
});

test('Android / browser back pops, forward pushes again', async ({ page }) => {
  await openNext(page);
  await expectTop(page, 'Screen 2');
  await page.goBack();
  await expectTop(page, 'Screen 1');
  await page.goForward();
  await expectTop(page, 'Screen 2');
});

test('stress: rapid double push then double pop never breaks the stack', async ({ page }) => {
  await openNext(page);
  await openNext(page);
  await openNext(page);
  await expectTop(page, 'Screen 4');
  await page.goBack();
  await page.goBack();
  await expectTop(page, 'Screen 2');
  await openNext(page);
  await page.goBack();
  await page.goBack();
  await expectTop(page, 'Screen 1');
  await settle(page);
  // Popped screens are gone; only Screen 1 over the Home root remains.
  await expect(page.locator('[data-tab="home"] section[data-screen]')).toHaveCount(2);
});

test('swipe-back: a short drag springs back, a long drag pops; interrupting with a push is safe', async ({ page }) => {
  await openNext(page);
  await expectTop(page, 'Screen 2');
  await settle(page);

  // Short, slow drag → springs back, still on Screen 2.
  await drag(page, 4, 60, 400);
  await expect(page).toHaveURL(/\/demo\/2$/);
  // Interrupt the spring-back with a push.
  await openNext(page);
  await expectTop(page, 'Screen 3');
  await settle(page);

  // Long drag → commits the pop.
  await drag(page, 4, 320, 300);
  await expectTop(page, 'Screen 2');
  await expect(page).toHaveURL(/\/demo\/2$/);
});

test('tabs keep their own stacks; re-tapping the active tab pops to root and scrolls to top', async ({ page }) => {
  await openNext(page);
  await expectTop(page, 'Screen 2');
  await tab(page, 'My Masjids').click();
  await expectTop(page, 'My Masjids');
  await tab(page, 'Home').click();
  await expectTop(page, 'Screen 2'); // Home's stack was kept

  // Re-tap the active tab → pop to root.
  await tab(page, 'Home').click();
  await expectTop(page, HOME);
  await expect(page).toHaveURL(new RegExp(`${APP_URL.replace(/[./]/g, '\\$&')}/?$`));

  // A scrolled root, two pushes, re-tap → back at the root, scrolled to top (the long Settings tab).
  await tab(page, 'Settings').click();
  await settle(page);
  await scroller(page).evaluate((element) => {
    element.scrollTop = 400;
  });
  await openNextInPlace(page);
  await openNextInPlace(page);
  await settle(page);
  await tab(page, 'Settings').click();
  await expect(page.locator('section[data-screen]:not([inert]) [data-screen-scroll]')).toHaveCount(1);
  await settle(page);
  await expect.poll(() => scroller(page).evaluate((element) => element.scrollTop)).toBe(0);

  // At the root, re-tapping just scrolls to top.
  await scroller(page).evaluate((element) => {
    element.scrollTop = 250;
  });
  await tab(page, 'Settings').click();
  await expect.poll(() => scroller(page).evaluate((element) => element.scrollTop)).toBe(0);
});

test('scroll position is kept per screen across push/pop', async ({ page }) => {
  await openNext(page);
  await expectTop(page, 'Screen 2');
  await settle(page);
  await scroller(page).evaluate((element) => {
    element.scrollTop = 300;
  });
  await openNextInPlace(page);
  await expectTop(page, 'Screen 3');
  await page.goBack();
  await expectTop(page, 'Screen 2');
  expect(await scroller(page).evaluate((element) => element.scrollTop)).toBe(300);
});

test('Scan modal: covers the app, app is inert, closing restores focus to the Scan button', async ({
  page,
  browserName,
}) => {
  await page.getByRole('button', { name: 'Scan QR code' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { level: 1 })).toHaveText('Scan masjid QR');
  await expect(page.locator('[data-tab="home"]').locator('..')).toHaveAttribute('inert', '');
  await settle(page);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
  // WebKit does not focus a tapped button, so there is no trigger to return to.
  if (browserName !== 'webkit') await expect(page.locator(':focus')).toHaveAttribute('data-tab-button', 'scan');
});

test('Urdu (RTL): push, back and swipe from the right edge work', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('mc.locale', 'ur');
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.locator('section[data-screen]:not([inert])').getByRole('button', { name: 'اگلی اسکرین کھولیں' }).click();
  await expect(page).toHaveURL(/\/demo\/2$/);
  await settle(page);
  const width = page.viewportSize()?.width ?? 400;
  await drag(page, width - 4, width - 320, 300);
  await expect(page).toHaveURL(/\/demo\/1$/);
});

test('no accessibility violations on a tab root, a pushed screen and the modal', async ({ page, expectAxeClean }) => {
  await expectAxeClean();
  await openNext(page);
  await expectTop(page, 'Screen 2');
  await expectAxeClean();
  await page.getByRole('button', { name: 'Scan QR code' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectAxeClean();
});
