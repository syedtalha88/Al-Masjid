/**
 * Single source of the product's working name and manifest colours (PHASE_00 T0.2).
 * Rename the product here only; nothing else in the code base hard-codes the name.
 *
 * Colours here are for places that cannot use CSS tokens (web app manifests, `<meta name="theme-color">`,
 * splash screens). UI code uses the tokens in `packages/ui` (06_DESIGN_SYSTEM §2).
 */
export const BRAND = {
  /** Full product name (manifest `name`, page titles). */
  name: 'Masjid Connect',
  /** Musalli app label under the home-screen icon (≤ 12 chars so Android doesn't truncate it). */
  shortName: 'Masjid',
  /** Admin app names. */
  adminName: 'Masjid Connect Admin',
  adminShortName: 'Masjid Admin',
  colors: {
    /** Manifest `background_color` and splash background = app canvas `--color-bg`. */
    background: '#F8F8F5',
    /** Manifest `theme_color` / `<meta name="theme-color">`. */
    theme: '#F8F8F5',
    /** Brand mark fill = `--color-primary-700`. */
    primary: '#13543C',
    /** Glyph colour on the brand mark = `--color-on-primary`. */
    onPrimary: '#FFFFFF',
  },
} as const;

export type Brand = typeof BRAND;
