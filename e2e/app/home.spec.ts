import { expect, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';
import { followByCode, followedIds } from '../support/device.ts';

// PHASE_02 T2.6 — A2 Home (07 A2): empty state; followed masjids as a carousel with next jamaat + countdown + strip;
// countdown across a prayer boundary with a pinned clock (minute-aligned re-render, no reload); Ramadan card; recent
// updates; bell dot. Needs the dev seed: Test Masjid Alpha (Dhuhr jamaat fixed 13:30, Jumu'ah 13:30 / 14:30), Beta
// (Ramadan mode around the seed day), Gamma.

// The pinned clock needs the API's Date header removed (below); requests a service worker makes bypass page routes.
test.use({ serviceWorkers: 'block' });

/** Today in India, "YYYY-MM-DD". */
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const isFriday = (date: string) => new Date(`${date}T12:00:00+05:30`).getUTCDay() === 5;

/**
 * Pins the page clock and drops the API's `Date` header: the app corrects a drifting device clock from that header
 * (00 §7), which would undo the pinned time.
 */
async function pinClock(page: Page, isoIst: string) {
  await page.clock.install({ time: new Date(isoIst) });
  await page.route('**/api/v1/**', async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers['date'];
    await route.fulfill({ response, headers });
  });
}

/** Carousel cards (direct children — each card holds its own strip list). */
const cards = (page: Page) => page.getByRole('list', { name: 'My Masjids' }).locator(':scope > li');
const firstCard = (page: Page) => cards(page).first();

test('no masjid yet: the empty state leads to the scanner', async ({ page, expectAxeClean }) => {
  await page.goto(APP_URL);
  await expect(page.getByRole('heading', { level: 1, name: 'Assalamu Alaikum' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Add your first masjid' })).toBeVisible();
  await expectAxeClean();
  await page.getByRole('button', { name: 'Scan masjid QR' }).click();
  await expect(page).toHaveURL(`${APP_URL}/scan`);
});

test('followed masjids: next jamaat counts down across the jamaat start without a reload', async ({
  page,
  expectAxeClean,
  capture,
}) => {
  const today = istToday();
  const friday = isFriday(today);
  await pinClock(page, `${today}T13:25:00+05:30`);
  await page.goto(APP_URL);
  await followByCode(page, APP_URL, ['TESTA001', 'TESTB002', 'TESTC003']);

  const card = firstCard(page);
  await expect(card.getByText('Test Masjid Alpha')).toBeVisible();
  await expect(cards(page)).toHaveCount(3);
  const panel = card.getByRole('button', { name: /Next Prayer/ });
  await expect(panel).toContainText(friday ? 'Jumu’ah' : 'Dhuhr');
  await expect(panel).toContainText('Starts in 5 min');
  // The strip marks the same prayer.
  await expect(card.locator('li[aria-current="time"]')).toContainText(friday ? 'Jumu’ah' : 'Dhuhr');
  await expectAxeClean();
  await capture('home');

  await page.clock.fastForward('05:00'); // 13:30
  await expect(panel).toContainText('Jamaat now');
  await page.clock.fastForward('10:00'); // 13:40 — Dhuhr is over
  if (friday) {
    await expect(panel).toContainText('Jumu’ah');
    await expect(panel).toContainText('50m left');
  } else {
    await expect(panel).toContainText('Asr');
    await expect(card.locator('li[aria-current="time"]')).toContainText('Asr');
  }

  // Recent updates (5 newest across the three) and the bell's unseen dot.
  await expect(page.getByRole('heading', { name: 'Recent Updates' })).toBeVisible();
  await expect(page.locator('section[aria-labelledby="home-recent"] li')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Updates, new items' })).toBeVisible();
  // The Ramadan card when the seeded Beta masjid is in Ramadan mode today.
  const versions = (await (
    await page.request.get(`${APP_URL}/api/v1/masjids/versions?ids=${(await followedIds(page)).join(',')}`)
  ).json()) as Record<string, { v: number }>;
  const beta = Object.entries(versions)[1];
  if (beta) {
    const bundle = (await (
      await page.request.get(`${APP_URL}/api/v1/masjids/${beta[0]}/bundle?v=${String(beta[1].v)}`)
    ).json()) as { ramadan: { start: string; end: string } | null };
    const inRamadan = bundle.ramadan !== null && bundle.ramadan.start <= today && today <= bundle.ramadan.end;
    await expect(page.locator('[data-ramadan-card]')).toHaveCount(inRamadan ? 1 : 0);
  }
});

test('a masjid card opens the masjid; See All opens My Masjids', async ({ page }) => {
  await page.goto(APP_URL);
  await followByCode(page, APP_URL, ['TESTA001']);
  await firstCard(page)
    .getByRole('button', { name: /Test Masjid Alpha/ })
    .click();
  await expect(page).toHaveURL(/\/masjid\/[0-9a-f-]{36}$/);
  await page.goBack();
  await page.getByRole('button', { name: 'See All' }).first().click();
  await expect(page).toHaveURL(`${APP_URL}/masjids`);
});
