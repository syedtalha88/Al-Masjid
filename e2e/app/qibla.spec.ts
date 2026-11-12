import { APP_LOCALES, expect, test } from '@mc/config/playwright';
import { distanceToKaabaKm, qiblaBearing } from '@mc/domain/qibla';
import type { Page, Request } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';
import { followByCode, gotoAfterStart, storedDevice } from '../support/device.ts';

// PHASE_07 T7.2 / T7.3 — A14 Qibla (07 A14, DECISIONS #118) with mocked sensors: from the first followed masjid's
// location ("Using: Test Masjid Delta"), the bearing and distance; a synthetic absolute-orientation stream turns the
// dial and, within ±3°, says "You are facing the Qibla"; no reading within 2 s → no-compass mode (bearing large +
// hint); "Use my location" (mocked geolocation) switches the source and NO request carries the coordinates; iOS-style
// permission card (granted / denied); location refused; no followed masjid; travelling (update or back to the masjid);
// reduced motion (no smoothing, no pulse); 4 locales, the dial never mirrored, axe clean.

const DELTA = { lat: 18.9535, lng: 72.8336 }; // Test Masjid Delta (dev seed, Mumbai)
const HERE = { latitude: 28.6139, longitude: 77.209 }; // the mocked phone: Delhi
const screen = (page: Page) => page.locator('section[data-screen]:not([inert])');

/** One reading for either platform (Android: absolute alpha = 360 − heading; iOS: webkitCompassHeading). */
async function headingTo(page: Page, heading: number) {
  await page.evaluate((value) => {
    // Android / Chromium: an absolute alpha (counter-clockwise).
    const absolute = new Event('deviceorientationabsolute');
    Object.assign(absolute, { alpha: (360 - value) % 360, beta: 0, gamma: 0, absolute: true });
    window.dispatchEvent(absolute);
    // iOS / WebKit: `webkitCompassHeading` on a relative event (ignored by the Android rule).
    const ios = new Event('deviceorientation');
    Object.assign(ios, { alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: value });
    window.dispatchEvent(ios);
  }, heading);
}

/** The turning part of the dial: its rotation in degrees (`rotate(-243deg)` → −243). */
async function dialRotation(page: Page): Promise<number> {
  const transform = await screen(page)
    .locator('[data-qibla-dial] > g')
    .first()
    .evaluate((node) => (node as SVGGElement).style.transform);
  return Number(/rotate\((-?[\d.e-]+)deg\)/u.exec(transform)?.[1] ?? Number.NaN);
}

/** Geolocation answering with an error (1 = permission denied) — what a phone with location off for the app does. */
async function refuseLocation(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {
      configurable: true,
      value: (_ok: unknown, fail: (error: { code: number; PERMISSION_DENIED: number }) => void) => {
        setTimeout(() => {
          fail({ code: 1, PERMISSION_DENIED: 1 });
        }, 50);
      },
    });
  });
}

async function openQibla(page: Page, { follow = true }: { follow?: boolean } = {}) {
  // A phone held upright: headless WebKit on Linux reports `screen.orientation.angle` 90 (with type
  // "portrait-primary"), which the heading rule adds to every reading. Pinned on the prototype — WebKit recreates the
  // `screen.orientation` object, so an own property is lost. Rotation itself is covered by the domain unit tests.
  await page.addInitScript(() => {
    if (typeof ScreenOrientation === 'function') {
      Object.defineProperty(ScreenOrientation.prototype, 'angle', { configurable: true, get: () => 0 });
    }
  });
  await page.goto(APP_URL);
  if (follow) await followByCode(page, APP_URL, ['TESTD004']);
  await gotoAfterStart(page, `${APP_URL}/qibla`);
  await expect(screen(page).locator(follow ? '[data-qibla-dial]' : '[data-qibla-need-location]')).toBeVisible();
}

test.describe('A14 Qibla', () => {
  test('masjid location → bearing + distance; the stream turns the dial; ±3° = facing', async ({
    page,
    expectAxeClean,
    capture,
  }) => {
    await openQibla(page);
    const bearing = Math.round(qiblaBearing(DELTA));
    const page_ = screen(page);
    await expect(page_.locator('[data-qibla-bearing]')).toHaveText(`Qibla is ${String(bearing)}° from North`);
    await expect(page_.locator('[data-qibla-distance]')).toHaveText(
      `Distance to Makkah: ${Math.round(distanceToKaabaKm(DELTA)).toLocaleString('en-IN')} km`,
    );
    await expect(page_.locator('[data-qibla-source]')).toContainText('Using: Test Masjid Delta');

    // A live compass: the dial turns by −heading; facing within ±3°.
    for (let n = 0; n < 5; n += 1) await headingTo(page, bearing - 40);
    await expect(page_.locator('[data-qibla-status]')).toHaveAttribute('data-qibla-status', 'live');
    await expect(page_.locator('[data-qibla-facing] span:not(.invisible)')).toHaveText(
      'Turn until the arrow points up',
    );
    for (let n = 0; n < 60; n += 1) await headingTo(page, bearing + 1);
    await expect(page_.locator('[data-qibla-dial]')).toHaveAttribute('data-aligned', 'true');
    await expect(page_.locator('[data-qibla-facing] span:not(.invisible)')).toHaveText('You are facing the Qibla');
    await expectAxeClean();
    await capture('a14-qibla-facing');
    for (let n = 0; n < 60; n += 1) await headingTo(page, bearing + 20);
    await expect(page_.locator('[data-qibla-dial]')).toHaveAttribute('data-aligned', 'false');
  });

  test('no compass: no reading within 2 s → the bearing large and the hint', async ({ page, capture }) => {
    await openQibla(page);
    const page_ = screen(page);
    await expect(page_.locator('[data-qibla-status]')).toHaveAttribute('data-qibla-status', 'none', { timeout: 5000 });
    const bearing = String(Math.round(qiblaBearing(DELTA)));
    await expect(page_.locator('[data-qibla-no-compass]')).toContainText(`${bearing}°`);
    await expect(page_.locator('[data-qibla-no-compass]')).toContainText(
      `Face ${bearing}° from North — use your phone's compass app if you need to`,
    );
    await capture('a14-qibla-no-compass');
  });

  test('"Use my location": the source changes and no request carries the coordinates', async ({ page, context }) => {
    const sent: string[] = [];
    // The context sees the service worker's own requests too; headers are checked with the URL and body.
    context.on('request', (request: Request) => {
      sent.push(`${request.url()}\n${JSON.stringify(request.headers())}\n${request.postData() ?? ''}`);
    });
    await context.grantPermissions(['geolocation'], { origin: APP_URL });
    await context.setGeolocation(HERE);
    await openQibla(page);
    await screen(page).getByRole('button', { name: 'Use my location' }).click();
    await expect(screen(page).locator('[data-qibla-source]')).toContainText('Using your location');
    const bearing = Math.round(qiblaBearing({ lat: 28.61, lng: 77.21 }));
    await expect(screen(page).locator('[data-qibla-bearing]')).toHaveText(`Qibla is ${String(bearing)}° from North`);
    await page.waitForLoadState('networkidle');
    for (const entry of sent) expect(entry).not.toMatch(/28\.61|77\.2[01]/u);

    // My data lists it under "On this phone" (05 §4: everything kept is shown).
    await page.goto(`${APP_URL}/settings/data`);
    await expect(
      screen(page).locator('div', { hasText: /^Qibla locationSaved \(accurate to about 1 km\)$/u }),
    ).toBeVisible();
    await page.goBack();

    // Travelling: the phone's location can be taken again, or dropped for the masjid's (07 A14).
    const source = screen(page).locator('[data-qibla-source]');
    await expect(source.getByRole('button', { name: 'Update my location' })).toBeVisible();
    await source.getByRole('button', { name: 'Use Test Masjid Delta instead' }).click();
    await expect(source).toContainText('Using: Test Masjid Delta');
    await expect(source.getByRole('button', { name: 'Use my location' })).toBeVisible();
    await expect(source.locator('[data-qibla-use-masjid]')).toHaveCount(0);
    await expect.poll(async () => (await storedDevice(page))?.['qibla']).toBeUndefined();
    await expect(screen(page).locator('[data-qibla-bearing]')).toHaveText(
      `Qibla is ${String(Math.round(qiblaBearing(DELTA)))}° from North`,
    );
  });

  test('location refused: the masjid stays the source and the page says how to allow it', async ({ page }) => {
    await refuseLocation(page);
    await openQibla(page);
    const source = screen(page).locator('[data-qibla-source]');
    await source.getByRole('button', { name: 'Use my location' }).click();
    await expect(source.getByRole('alert')).toHaveText(
      "Location is off for this app. Allow it in your phone's settings, or follow a masjid to use its location.",
    );
    await expect(source).toContainText('Using: Test Masjid Delta');
  });

  test('no followed masjid: "Where are you?" until the phone gives its location', async ({
    page,
    context,
    expectAxeClean,
  }) => {
    await context.grantPermissions(['geolocation'], { origin: APP_URL });
    await context.setGeolocation(HERE);
    await openQibla(page, { follow: false });
    const card = screen(page).locator('[data-qibla-need-location]');
    await expect(card).toContainText('Where are you?');
    await expect(screen(page).locator('[data-qibla-dial]')).toHaveCount(0);
    await expectAxeClean();
    await card.getByRole('button', { name: 'Use my location' }).click();
    await expect(screen(page).locator('[data-qibla-source]')).toContainText('Using your location');
    // Nothing to go back to: no "Use … instead" without a followed masjid.
    await expect(screen(page).locator('[data-qibla-use-masjid]')).toHaveCount(0);
  });

  test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('the dial snaps to each reading (no smoothing) and the aligned glow does not pulse', async ({ page }) => {
      await openQibla(page);
      const bearing = Math.round(qiblaBearing(DELTA));
      await headingTo(page, bearing - 40);
      await expect(screen(page).locator('[data-qibla-status]')).toHaveAttribute('data-qibla-status', 'live');
      await expect.poll(() => dialRotation(page)).toBeCloseTo(-(bearing - 40), 1);
      await headingTo(page, bearing + 1);
      await expect.poll(() => dialRotation(page)).toBeCloseTo(-(bearing + 1), 1);
      await expect(screen(page).locator('[data-qibla-dial]')).toHaveAttribute('data-aligned', 'true');
      const glow = screen(page).locator('[data-qibla-glow]');
      expect(await glow.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
      expect(await glow.evaluate((node) => getComputedStyle(node).opacity)).toBe('0.4');
    });
  });

  test.describe('as an iPhone', () => {
    test.use({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    });

    test('iOS: the compass needs a tap first (DeviceOrientationEvent.requestPermission)', async ({ page }) => {
      await page.addInitScript(() => {
        Object.assign(window.DeviceOrientationEvent, { requestPermission: () => Promise.resolve('granted') });
      });
      await openQibla(page);
      const card = screen(page).locator('[data-qibla-motion]');
      await expect(card).toBeVisible();
      await card.getByRole('button', { name: 'Turn on compass' }).click();
      await expect(card).toHaveCount(0);
    });

    test('iOS: motion refused → the bearing large with the "compass is off" hint', async ({ page }) => {
      await page.addInitScript(() => {
        Object.assign(window.DeviceOrientationEvent, { requestPermission: () => Promise.resolve('denied') });
      });
      await openQibla(page);
      await screen(page).locator('[data-qibla-motion]').getByRole('button', { name: 'Turn on compass' }).click();
      await expect(screen(page).locator('[data-qibla-status]')).toHaveAttribute('data-qibla-status', 'denied');
      const fallback = screen(page).locator('[data-qibla-no-compass]');
      await expect(fallback).toContainText(`${String(Math.round(qiblaBearing(DELTA)))}°`);
      await expect(fallback).toContainText('The compass is off. The direction is shown in degrees instead.');
      await expect(screen(page).locator('[data-qibla-motion]')).toHaveCount(0);
      await expect(screen(page).locator('[data-qibla-facing]')).toHaveCount(0);
    });
  });
});

for (const locale of APP_LOCALES) {
  test.describe(`A14 Qibla (${locale})`, () => {
    test.use({ appLocale: locale });

    test('the page in this language; the dial is never mirrored; axe clean', async ({
      page,
      expectAxeClean,
      capture,
    }) => {
      await openQibla(page);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
      // N is at the top of the dial (x = centre) and E to its right in every locale.
      const letters = await screen(page)
        .locator('[data-qibla-dial] text')
        .evaluateAll((nodes) => nodes.map((node) => ({ text: node.textContent, x: Number(node.getAttribute('x')) })));
      const x = (text: string) => letters.find((letter) => letter.text === text)?.x ?? Number.NaN;
      expect(x('N')).toBeCloseTo(150, 0);
      expect(x('E')).toBeGreaterThan(x('W'));
      await expectAxeClean();
      await capture('a14-qibla');
    });
  });
}
