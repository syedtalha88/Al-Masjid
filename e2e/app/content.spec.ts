import { APP_LOCALES, expect, test } from '@mc/config/playwright';
import type { Page } from '@playwright/test';

import { APP_URL } from '../../playwright.config.ts';
import { followByCode, registerDevice, storedDevice } from '../support/device.ts';

// PHASE_02 T2.11 — A7 Announcements, A8 Hadith & Quran (+ Read Full), A9 Dua Requests (07 A7–A9) and 10 §6 journey 8
// (Ameen counts once per device, also when said offline). Arabic is the 10 §5 placeholder from the dev seed — never
// mirrored, Amiri, in every locale. Needs the dev seed (TESTA001 = Test Masjid Alpha, TESTC003 = Test Masjid Gamma).

const ARABIC = 'نص تجريبي للعرض فقط';
const screen = (page: Page) => page.locator('section[data-screen]:not([inert])');

/**
 * Follows a seed masjid and opens Masjid Detail; with `row`, taps that overview row (the in-app path), else goes to
 * `section` by URL (localized row labels).
 */
async function openSection(
  page: Page,
  code: string,
  target: { readonly row: RegExp } | { readonly section: 'announcements' | 'hadith' | 'duas' },
  register = false,
): Promise<string> {
  await page.goto(APP_URL);
  if (register) await registerDevice(page);
  const [masjidId = ''] = await followByCode(page, APP_URL, [code]);
  if ('section' in target) {
    await page.goto(`${APP_URL}/masjid/${masjidId}/${target.section}`);
    return masjidId;
  }
  await page.goto(`${APP_URL}/masjid/${masjidId}`);
  await screen(page).getByRole('button', { name: target.row }).last().click();
  return masjidId;
}

/** The server's live Ameen count of an item (no CDN locally). */
async function serverAmeens(page: Page, publicId: string): Promise<number> {
  const body = (await (await page.request.get(`${APP_URL}/api/v1/ameens?items=${publicId}`)).json()) as {
    counts: Record<string, number>;
  };
  return body.counts[publicId] ?? 0;
}

test('A7: announcements — chips, template body, event badge; detail with photo viewer and .ics', async ({
  page,
  expectAxeClean,
  capture,
}) => {
  await openSection(page, 'TESTA001', { row: /^Announcements/ });
  await expect(page.getByRole('heading', { level: 1, name: 'Announcements' })).toBeVisible();
  const list = screen(page);
  // A template notice: title from the template, body formatted for the locale.
  const water = list.getByRole('button', { name: 'No water supply' });
  await expect(water).toBeVisible();
  await expect(water).toContainText(/Water will not be available from 10:00\sAM to 2:00\sPM\./);
  await expect(water).toContainText('Important');
  await expect(list.getByRole('button', { name: 'Children’s weekend class' })).toContainText(/·/);
  await expectAxeClean();
  await capture('announcements');

  await list.getByRole('radio', { name: 'Events' }).click();
  await expect(list.getByRole('button', { name: 'No water supply' })).toHaveCount(0);
  await expect(list.getByRole('button', { name: 'Children’s weekend class' })).toBeVisible();

  await list.getByRole('button', { name: 'Children’s weekend class' }).click();
  await expect(page).toHaveURL(/\/items\/seedA0000003$/);
  const detail = screen(page);
  await expect(detail.getByRole('heading', { level: 2, name: 'Children’s weekend class' })).toBeVisible();
  await expect(detail.getByText(/^Event: /)).toBeVisible();
  await expectAxeClean();
  await capture('announcement-detail');

  // Photo → full-screen viewer; keyboard zoom moves only the photo (transform), close returns.
  await detail.getByRole('button', { name: 'Open photo' }).click();
  const viewer = page.getByRole('dialog', { name: 'Photo for this notice' });
  await expect(viewer).toBeVisible();
  await page.keyboard.press('+');
  await expect
    .poll(() => viewer.locator('[data-image-box]').evaluate((node) => (node as HTMLElement).style.transform))
    .toContain('scale(1.25)');
  await expectAxeClean();
  await viewer.getByRole('button', { name: 'Close photo' }).click();
  await expect(viewer).toBeHidden();

  // Add to calendar → an .ics file for this event.
  const download = page.waitForEvent('download');
  await detail.getByRole('button', { name: 'Add to calendar' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('event-seedA0000003.ics');
  const path = await file.path();
  const { readFile } = await import('node:fs/promises');
  const ics = await readFile(path, 'utf8');
  expect(ics).toContain('BEGIN:VEVENT\r\n');
  expect(ics).toContain('SUMMARY:Children’s weekend class\r\n');
  expect(ics).toContain('URL:https://');
});

for (const locale of APP_LOCALES) {
  test.describe(`A8 hadith & Quran (${locale})`, () => {
    test.use({ appLocale: locale });

    test('Arabic stays Arabic (not mirrored, Amiri); hero + cards; Quran tab; Save; Read Full reader', async ({
      page,
      expectAxeClean,
      capture,
    }) => {
      await openSection(page, 'TESTA001', { section: 'hadith' });
      const view = screen(page);
      const arabic = view.getByText(ARABIC).first();
      await expect(arabic).toBeVisible();
      const style = await arabic.evaluate((node) => {
        const computed = getComputedStyle(node);
        return {
          lang: node.getAttribute('lang'),
          dir: node.getAttribute('dir'),
          direction: computed.direction,
          family: computed.fontFamily,
          transform: computed.transform,
          align: computed.textAlign,
        };
      });
      expect(style).toMatchObject({ lang: 'ar', dir: 'rtl', direction: 'rtl', transform: 'none', align: 'center' });
      expect(style.family).toMatch(/Amiri/);
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === 'ur' ? 'rtl' : 'ltr');
      // The admin's note is English in the seed: it keeps its own direction in an RTL page (full stop at the end).
      await expect(
        view.getByText('Sample note from the masjid — dev only.').evaluate((node) => getComputedStyle(node).direction),
      ).resolves.toBe('ltr');
      await expectAxeClean();
      await capture('hadith');

      if (locale !== 'en') return;
      // Quran tab: the ayat only.
      await view.getByRole('radio', { name: 'Quran' }).click();
      await expect(view.getByRole('radio', { name: 'Quran' })).toHaveAttribute('aria-checked', 'true');
      await expect(view.getByText(ARABIC).first()).toBeVisible();
      await view.getByRole('radio', { name: 'Hadith' }).click();

      // Save on this phone.
      const save = view.getByRole('button', { name: 'Save' }).first();
      await save.click();
      await expect(view.getByRole('button', { name: 'Saved' }).first()).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(async () => ((await storedDevice(page))?.['saved'] as unknown[] | undefined)?.length).toBe(1);

      // Read Full: bigger Arabic (remembered), transliteration off, source and licence line.
      await view.getByRole('button', { name: 'Read Full' }).first().click();
      await expect(page).toHaveURL(/\/items\/seedA/);
      const reader = screen(page);
      const big = reader.getByText(ARABIC);
      const before = await big.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
      await reader.getByRole('button', { name: 'Larger Arabic text' }).click();
      await expect
        .poll(() => big.evaluate((node) => parseFloat(getComputedStyle(node).fontSize)))
        .toBeGreaterThan(before);
      await expect(reader.getByText('Sample transliteration — DEV ONLY')).toBeVisible();
      await reader.getByRole('switch', { name: 'Show transliteration' }).click();
      await expect(reader.getByText('Sample transliteration — DEV ONLY')).toBeHidden();
      await expect(reader.getByText(/Source: Development fixture/)).toBeVisible();
      // A clean capture: the "Saved" toast has gone.
      await expect(page.getByText('Saved on this phone').filter({ visible: true })).toHaveCount(0, { timeout: 10_000 });
      await expectAxeClean();
      await capture('reader');
      const settings = (await storedDevice(page))?.['settings'] as { arabicScale: number; transliteration: boolean };
      expect(settings.arabicScale).toBeCloseTo(1.1);
      expect(settings.transliteration).toBe(false);
    });
  });
}

test('journey 8: Ameen counts once per device — also when said offline', async ({
  page,
  context,
  expectAxeClean,
  capture,
}) => {
  // Many steps (register, follow, reload, an offline round trip, detail): WebKit on the Windows dev PC fetches one
  // resource at a time and needs more than the default 30 s.
  test.slow();
  await openSection(page, 'TESTA001', { row: /^Dua Requests/ }, true);
  await expect(page.getByRole('heading', { level: 1, name: 'Dua Requests' })).toBeVisible();
  const view = screen(page);
  const named = view.locator('article').filter({ hasText: 'For Test Person A' });
  const inteqal = view.locator('article').filter({ hasText: 'Inteqal' });
  await expect(named).toBeVisible();
  // Private name: the community wording; janaza row on the inteqal request.
  await expect(inteqal).toContainText('For a brother or sister from our community');
  await expect(inteqal).toContainText(/Janaza: .+ · Test Masjid Alpha/);
  await expect(named.getByText(ARABIC)).toHaveAttribute('dir', 'rtl');
  await expectAxeClean();
  await capture('duas');

  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/ameen')) posts.push(request.url());
  });
  const before = await serverAmeens(page, 'seedA0000001');
  await named.getByRole('button', { name: 'Ameen' }).click();
  const said = named.getByRole('button', { name: 'You said Ameen' });
  await expect(said).toHaveAttribute('aria-pressed', 'true');
  await expect(named).toContainText(`${String(before + 1)} said Ameen`);
  await expect.poll(() => serverAmeens(page, 'seedA0000001')).toBe(before + 1);
  // Once per device: pressing again sends nothing; after a reload the button is still filled.
  await said.click();
  await page.reload();
  await expect(
    screen(page)
      .locator('article')
      .filter({ hasText: 'For Test Person A' })
      .getByRole('button', { name: 'You said Ameen' }),
  ).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(await serverAmeens(page, 'seedA0000001')).toBe(before + 1);

  // Offline: recorded at once, sent when the connection returns.
  const inteqalId = 'seedA0000007';
  const offlineBefore = await serverAmeens(page, inteqalId);
  await context.setOffline(true);
  await screen(page).locator('article').filter({ hasText: 'Inteqal' }).getByRole('button', { name: 'Ameen' }).click();
  await expect(
    screen(page).locator('article').filter({ hasText: 'Inteqal' }).getByRole('button', { name: 'You said Ameen' }),
  ).toBeVisible();
  expect((await storedDevice(page))?.['pendingAmeens']).toEqual([inteqalId]);
  await context.setOffline(false);
  await expect.poll(async () => (await storedDevice(page))?.['pendingAmeens'], { timeout: 15_000 }).toEqual([]);
  expect(await serverAmeens(page, inteqalId)).toBe(offlineBefore + 1);

  // The dua detail: full message, the dua, the large Ameen already filled.
  await screen(page)
    .locator('article')
    .filter({ hasText: 'For Test Person A' })
    .getByRole('button', { name: 'Request for Dua' })
    .click();
  await expect(page).toHaveURL(/\/items\/seedA0000001$/);
  await expect(screen(page).getByRole('button', { name: 'You said Ameen' })).toBeVisible();
  await expectAxeClean();
  await capture('dua-detail');
});

test('A9: requests older than 30 days sit in the collapsed "Older" section', async ({ page, capture }) => {
  await openSection(page, 'TESTC003', { section: 'duas' });
  const view = screen(page);
  const older = view.getByRole('button', { name: /Older \(1\)/ });
  await expect(older).toHaveAttribute('aria-expanded', 'false');
  await expect(view.getByText('Please continue to remember the sick of our community in your duas.')).toBeHidden();
  await older.click();
  await expect(older).toHaveAttribute('aria-expanded', 'true');
  await expect(view.getByText('Please continue to remember the sick of our community in your duas.')).toBeVisible();
  await capture('duas-older');
});
