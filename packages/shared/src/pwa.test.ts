import { describe, expect, it } from 'vitest';

import { BRAND } from './brand.ts';
import { brandMarkColor, brandMarkSvg } from './brand-mark.ts';
import { ICON_FILES, SPLASH_SCREENS, splashFile, webManifest } from './pwa.ts';

// PHASE_00 T0.11 / DECISIONS #30: the manifest schema test that, with CDP installability checks and the
// owner's manual install, replaces Lighthouse's PWA category.

describe.each(['app', 'admin'] as const)('webManifest(%s)', (app) => {
  const manifest = webManifest(app);

  it('has the installability fields browsers require', () => {
    expect(manifest.id).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.start_url).toBe('/?source=pwa');
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
    expect(manifest.display).toBe('standalone');
    expect(manifest.display_override).toEqual(['standalone']);
    expect(manifest.orientation).toBe('portrait');
    expect(manifest.dir).toBe('auto');
    expect(manifest.lang).toBe('en');
    expect(manifest.name.length).toBeGreaterThan(0);
    // Android truncates labels past ~12 characters.
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
  });

  it('uses the canvas color for splash and theme', () => {
    expect(manifest.background_color).toBe(BRAND.colors.background);
    expect(manifest.theme_color).toBe(BRAND.colors.theme);
    expect(manifest.background_color).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('ships 192 + 512 any and maskable PNGs and the 96 monochrome badge', () => {
    const icon = (purpose: string, size: number) =>
      manifest.icons.find((item) => item.purpose === purpose && item.sizes === `${String(size)}x${String(size)}`);
    for (const size of [192, 512]) {
      expect(icon('any', size)?.type).toBe('image/png');
      expect(icon('maskable', size)?.type).toBe('image/png');
    }
    expect(icon('monochrome', 96)?.src).toBe(`/${ICON_FILES.badge}`);
    for (const item of manifest.icons) expect(item.src.startsWith('/icons/')).toBe(true);
  });

  it('is JSON-serializable without loss', () => {
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });
});

describe('app-only manifest fields', () => {
  it('musalli app focuses the open window and has the Updates shortcut (Qibla from Phase 7); admin has neither', () => {
    const app = webManifest('app');
    expect(app.launch_handler).toEqual({ client_mode: 'focus-existing' });
    expect(app.shortcuts?.map((shortcut) => shortcut.url)).toEqual(['/updates?source=shortcut']);
    const admin = webManifest('admin');
    expect(admin.launch_handler).toBeUndefined();
    expect(admin.shortcuts).toBeUndefined();
    expect(admin.name).toBe(BRAND.adminName);
  });
});

describe('brand mark', () => {
  it('draws the glyph in white on the app color; admin is darker', () => {
    const app = brandMarkSvg('any', 'app');
    expect(app).toContain(`fill="${BRAND.colors.primary}"`);
    expect(app).toContain(`stroke="${BRAND.colors.onPrimary}"`);
    expect(brandMarkSvg('apple', 'admin')).toContain(`fill="${BRAND.colors.adminPrimary}"`);
    expect(brandMarkColor('admin')).not.toBe(brandMarkColor('app'));
  });

  it('monochrome has no background; maskable and apple are full-bleed', () => {
    expect(brandMarkSvg('monochrome')).not.toContain('<rect');
    expect(brandMarkSvg('maskable')).toContain('<rect width="512" height="512"');
    expect(brandMarkSvg('apple')).toContain('<rect width="512" height="512"');
    expect(brandMarkSvg('any')).toContain('rx="112"');
  });

  it('splash screens are portrait, unique and match their CSS size × ratio', () => {
    const names = new Set(SPLASH_SCREENS.map(splashFile));
    expect(names.size).toBe(SPLASH_SCREENS.length);
    for (const screen of SPLASH_SCREENS) {
      expect(screen.height).toBeGreaterThan(screen.width);
      expect(screen.cssWidth * screen.ratio).toBe(screen.width);
      expect(screen.cssHeight * screen.ratio).toBe(screen.height);
    }
  });
});
