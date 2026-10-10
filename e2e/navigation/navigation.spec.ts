import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';

// T0.9 acceptance (08 §3): stack push/pop, Android/browser back, swipe-back, tabs keep their stacks,
// re-tap pops to root + scrolls top, modal, focus management, inert covered screens, stress and perf.

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

/** Waits until no screen is mid-transition (CSS transitions settled). */
async function settle(page: Page) {
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLElement>('section[data-screen]')].every(
      (element) => element.getAnimations().length === 0,
    ),
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expectTop(page, 'Masjid Connect');
});

test('push and back: new screen on top, focus on its title, previous screen inert and restored', async ({
  page,
  browserName,
}) => {
  await openNext(page);
  await expectTop(page, 'Screen 2');
  await settle(page);
  await expect(page.locator(':focus')).toHaveText('Screen 2');
  await expect(page).toHaveURL(/\/demo\/2$/);
  await expect(page.locator('section[data-screen][inert]')).toHaveCount(1);

  await page.locator('section[data-screen]:not([inert])').getByRole('button', { name: 'Back' }).click();
  await expectTop(page, 'Masjid Connect');
  await settle(page);
  // Focus returns to the control that opened the screen (WebKit does not focus buttons on tap → the title).
  await expect(page.locator(':focus')).toHaveText(browserName === 'webkit' ? 'Masjid Connect' : 'Open next screen');
});

test('Android / browser back pops, forward pushes again', async ({ page }) => {
  await openNext(page);
  await expectTop(page, 'Screen 2');
  await page.goBack();
  await expectTop(page, 'Masjid Connect');
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
  await expectTop(page, 'Masjid Connect');
  await settle(page);
  // Popped screens are gone; only the root remains.
  await expect(page.locator('[data-tab="home"] section[data-screen]')).toHaveCount(1);
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

  // Re-tap the active tab → pop to root. Then scroll the root so "scrolls to top" is really checked.
  await tab(page, 'Home').click();
  await expectTop(page, 'Masjid Connect');
  await settle(page);
  await scroller(page).evaluate((element) => {
    element.scrollTop = 400;
  });
  await openNextInPlace(page);
  await openNextInPlace(page);
  await expectTop(page, 'Screen 3');
  await settle(page);
  await tab(page, 'Home').click();
  await expectTop(page, 'Masjid Connect');
  await settle(page);
  await expect.poll(() => scroller(page).evaluate((element) => element.scrollTop)).toBe(0);

  // At the root, re-tapping just scrolls to top.
  await scroller(page).evaluate((element) => {
    element.scrollTop = 250;
  });
  await tab(page, 'Home').click();
  await expect.poll(() => scroller(page).evaluate((element) => element.scrollTop)).toBe(0);
  await expect(page).toHaveURL(new RegExp(`${APP_URL.replace(/[./]/g, '\\$&')}/?$`));
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
  await expect(dialog.getByRole('heading', { level: 1 })).toHaveText('Scan');
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
  await page.locator('section[data-screen]:not([inert])').getByRole('button').first().click();
  await expect(page).toHaveURL(/\/demo\/2$/);
  await settle(page);
  const width = page.viewportSize()?.width ?? 400;
  await drag(page, width - 4, width - 320, 300);
  await expect(page).not.toHaveURL(/\/demo\//);
});

test('no accessibility violations on a tab root, a pushed screen and the modal', async ({ page }) => {
  const scan = async () => {
    await settle(page);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  };
  await scan();
  await openNext(page);
  await expectTop(page, 'Screen 2');
  await scan();
  await page.getByRole('button', { name: 'Scan QR code' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await scan();
});
