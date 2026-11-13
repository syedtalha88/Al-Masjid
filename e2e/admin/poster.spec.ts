import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { expect, test } from '@mc/config/playwright';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';

import { ADMIN_URL } from '../../playwright.config.ts';
import { HOOKS, registerWithInvite, resetRateLimits, seedSuperAdminInvite, virtualAuthenticator } from './helpers.ts';

// PHASE_08 T8.8 — C3 QR poster: the Super Admin opens Masjid → QR poster; the sheet shows the masjid, a QR that decodes
// to `<app origin>/m/<CODE>` (read back with ZXing from the rendered page), the follow code, and the 3 steps in all four
// languages (Urdu right-to-left, Telugu and Hindi shaped by the browser); the print output is one page of exactly A4
// or A5 (`page.pdf` with the poster's own @page size). Axe clean. Seed masjid Alpha (`TESTA001`).

const A4 = [595.28, 841.89];
const A5 = [419.53, 595.28];

/** Page count and the first page's MediaBox [width, height] in points, read from the PDF text. */
function pdfPages(pdf: Buffer): { readonly pages: number; readonly box: readonly number[] } {
  const text = pdf.toString('latin1');
  const pages = (text.match(/\/Type\s*\/Page(?!s)/gu) ?? []).length;
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/u.exec(text);
  return { pages, box: box ? [Number(box[1]), Number(box[2])] : [] };
}

test.describe('QR poster (T8.8)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('A4 / A5 sheet: decodable follow QR, the code, four languages; one exact page each', async ({
    page,
    browserName,
    expectAxeClean,
    capture,
  }) => {
    test.skip(browserName !== 'chromium', 'virtual authenticator + page.pdf are Chromium features');
    test.setTimeout(180_000);
    await resetRateLimits(page.request);
    await virtualAuthenticator(page);
    const token = await seedSuperAdminInvite(page.request, 'Test Owner', 'en');
    await registerWithInvite(page, `${ADMIN_URL}/invite#${token}`, 'Test Owner', 'en');
    const list = (await (await page.request.get(`${ADMIN_URL}/api/super/masjids?q=TESTA001`)).json()) as {
      masjids: { id: string; followCode: string }[];
    };
    const alpha = list.masjids.find((masjid) => masjid.followCode === 'TESTA001');
    if (!alpha) throw new Error('seed masjid Alpha missing');

    await page.goto(`${ADMIN_URL}/super/masjids/${alpha.id}`);
    await page.getByRole('button', { name: 'QR poster' }).click();
    const sheet = page.locator('[data-poster="a4"]').first();
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-poster-code]')).toHaveText('TEST-A001');
    for (const locale of ['en', 'hi', 'ur', 'te']) {
      await expect(sheet.locator(`[data-poster-steps="${locale}"] li`)).toHaveCount(3);
    }
    await expect(sheet.locator('[data-poster-steps="ur"]')).toHaveAttribute('dir', 'rtl');
    await expect(sheet.locator('[data-poster-steps="te"]')).toContainText('ఫాలో');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    // The QR, as rendered, decodes to the app's follow link.
    const require = createRequire(import.meta.url);
    const wasm = readFileSync(
      join(dirname(require.resolve('zxing-wasm/reader')), '..', '..', 'reader', 'zxing_reader.wasm'),
    );
    prepareZXingModule({
      overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) },
    });
    const shot = await sheet.locator('[data-poster-qr]').screenshot();
    const [decoded] = await readBarcodes(new Blob([new Uint8Array(shot)], { type: 'image/png' }), {
      formats: ['QRCode'],
    });
    // The build's VITE_PUBLIC_APP_ORIGIN (the dev origin in local / CI builds; the real one is checked by the env schema).
    expect(decoded?.text).toMatch(/^https?:\/\/[a-z0-9.-]+(:\d+)?\/m\/TESTA001$/u);
    // Error correction Q (ZXing reports it in `extra`, a JSON object: {"ECLevel":"Q", …}).
    expect(JSON.parse(decoded?.extra ?? '{}')).toMatchObject({ ECLevel: 'Q' });
    await expectAxeClean();
    await capture('c3-poster-a4');

    // The printed sheet as the printer sees it (kept with the test output for review).
    await page.emulateMedia({ media: 'print' });
    await page
      .locator('[data-poster-print] [data-poster]')
      .screenshot({ path: test.info().outputPath('print-a4.png') });
    await page.emulateMedia({ media: 'screen' });

    // Print: one page of exactly A4, then A5.
    const a4 = pdfPages(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    expect(a4.pages).toBe(1);
    expect(a4.box[0]).toBeCloseTo(A4[0] ?? 0, 0);
    expect(a4.box[1]).toBeCloseTo(A4[1] ?? 0, 0);
    await page
      .getByRole('radio', { name: 'A5' })
      .or(page.getByRole('tab', { name: 'A5' }))
      .click();
    await expect(page.locator('[data-poster="a5"]').first()).toBeVisible();
    const a5 = pdfPages(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    expect(a5.pages).toBe(1);
    expect(a5.box[0]).toBeCloseTo(A5[0] ?? 0, 0);
    expect(a5.box[1]).toBeCloseTo(A5[1] ?? 0, 0);
  });
});
