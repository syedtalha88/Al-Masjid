import { BRAND } from './brand.ts';

/**
 * The placeholder brand mark (PHASE_00 T0.11): the masjid glyph (dome + minaret, 06 §5) in white on the brand
 * green. The owner may replace it later; every PWA icon and splash screen is generated from this one source by
 * `scripts/generate-pwa-assets.ts`.
 */
export type BrandMarkVariant =
  /** Rounded square on transparent corners (browser install dialogs, favicons). */
  | 'any'
  /** Full-bleed square, glyph inside the 80 % safe zone (Android adaptive icons). */
  | 'maskable'
  /** Full-bleed square without transparency (iOS rounds the corners itself). */
  | 'apple'
  /** White glyph on transparent (Android notification badge: only alpha is used). */
  | 'monochrome';

export type BrandMarkApp = 'app' | 'admin';

/** The glyph's strokes on a 256-unit grid (same paths as `MasjidGlyph` in @mc/ui). */
const GLYPH = [
  'M40 208H224',
  'M80 208v-68h96v68',
  'M84 140c0-36 28-48 44-64 16 16 44 28 44 64',
  'M128 76V56',
  'M112 208v-24a16 16 0 0 1 32 0v24',
  'M208 208V112',
  'M196 112l12-24 12 24Z',
];

/** Fill of the mark per app: musalli = primary-700, admin = primary-900 so the two installs differ. */
export function brandMarkColor(app: BrandMarkApp): string {
  return app === 'admin' ? BRAND.colors.adminPrimary : BRAND.colors.primary;
}

/**
 * The brand mark as an SVG document (512×512 viewBox).
 *
 * @param variant - see {@link BrandMarkVariant}.
 * @param app - which app's color.
 * @returns a standalone SVG string (no external references).
 */
export function brandMarkSvg(variant: BrandMarkVariant, app: BrandMarkApp = 'app'): string {
  // Glyph scale: the glyph's 176-unit wide drawing fills ~58 % of the tile (≈ 46 % for maskable's safe zone).
  const glyphScale = variant === 'maskable' ? 1.1 : 1.36;
  const offset = 256 - 128 * glyphScale - 4 * glyphScale;
  const glyph = `<g transform="translate(${String(offset)} ${String(offset + 8 * glyphScale)}) scale(${String(glyphScale)})" fill="none" stroke="${
    BRAND.colors.onPrimary
  }" stroke-width="16" stroke-linecap="round" stroke-linejoin="round">${GLYPH.map((d) => `<path d="${d}"/>`).join('')}</g>`;
  const fill = brandMarkColor(app);
  const background =
    variant === 'monochrome'
      ? ''
      : variant === 'any'
        ? `<rect x="16" y="16" width="480" height="480" rx="112" fill="${fill}"/>`
        : `<rect width="512" height="512" fill="${fill}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${background}${glyph}</svg>`;
}
