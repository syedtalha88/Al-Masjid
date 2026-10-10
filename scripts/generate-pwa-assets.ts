// `pnpm pwa:assets` — renders every PWA icon and iPhone launch screen from the one brand mark
// (packages/shared/src/brand-mark.ts) with Playwright's Chromium — no image toolchain dependency (T0.11).
// Writes apps/{app,admin}/public/{icons,splash}/; the output is committed. Re-run after changing the mark.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { BRAND } from '../packages/shared/src/brand.ts';
import { type BrandMarkApp, brandMarkSvg, type BrandMarkVariant } from '../packages/shared/src/brand-mark.ts';
import { ICON_FILES, SPLASH_SCREENS, splashFile } from '../packages/shared/src/pwa.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

interface Raster {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly html: string;
  readonly transparent: boolean;
}

const page = (body: string, background: string) =>
  `<!doctype html><html><body style="margin:0;background:${background};display:flex;align-items:center;justify-content:center;height:100vh;overflow:hidden">${body}</body></html>`;

const icon = (file: string, size: number, variant: BrandMarkVariant, app: BrandMarkApp): Raster => ({
  file,
  width: size,
  height: size,
  html: page(
    brandMarkSvg(variant, app).replace('width="512" height="512"', `width="${String(size)}" height="${String(size)}"`),
    'transparent',
  ),
  transparent: variant === 'any' || variant === 'monochrome',
});

function rasters(app: BrandMarkApp): Raster[] {
  const icons = [
    icon(ICON_FILES.any192, 192, 'any', app),
    icon(ICON_FILES.any512, 512, 'any', app),
    icon(ICON_FILES.maskable192, 192, 'maskable', app),
    icon(ICON_FILES.maskable512, 512, 'maskable', app),
    icon(ICON_FILES.apple, 180, 'apple', app),
    icon(ICON_FILES.badge, 96, 'monochrome', app),
  ];
  // Launch screens: the canvas color with the mark centered at a quarter of the width (06 §3.6 splash).
  const splashes = SPLASH_SCREENS.map((screen) => {
    const mark = Math.round(screen.width / 4);
    return {
      file: splashFile(screen),
      width: screen.width,
      height: screen.height,
      html: page(
        brandMarkSvg('any', app).replace(
          'width="512" height="512"',
          `width="${String(mark)}" height="${String(mark)}"`,
        ),
        BRAND.colors.background,
      ),
      transparent: false,
    };
  });
  return [...icons, ...splashes];
}

const browser = await chromium.launch();
try {
  for (const app of ['app', 'admin'] as const) {
    const out = join(root, 'apps', app, 'public');
    for (const raster of rasters(app)) {
      const target = join(out, raster.file);
      mkdirSync(dirname(target), { recursive: true });
      const tab = await browser.newPage({ viewport: { width: raster.width, height: raster.height } });
      await tab.setContent(raster.html);
      await tab.screenshot({ path: target, omitBackground: raster.transparent });
      await tab.close();
    }
    writeFileSync(join(out, ICON_FILES.favicon), brandMarkSvg('any', app));
    process.stdout.write(`${app}: wrote ${String(rasters(app).length + 1)} files to ${out}\n`);
  }
} finally {
  await browser.close();
}
