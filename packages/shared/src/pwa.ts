import { BRAND } from './brand.ts';
import type { BrandMarkApp } from './brand-mark.ts';

/** PNG icons written by `scripts/generate-pwa-assets.ts` into each app's `public/icons/`. */
export const ICON_FILES = {
  any192: 'icons/icon-192.png',
  any512: 'icons/icon-512.png',
  maskable192: 'icons/icon-maskable-192.png',
  maskable512: 'icons/icon-maskable-512.png',
  /** 180×180, full-bleed (iOS home screen). */
  apple: 'icons/apple-touch-icon.png',
  /** 96×96 white glyph on transparent (Android notification badge, 07 A17). */
  badge: 'icons/badge-96.png',
  favicon: 'icons/favicon.svg',
} as const;

/**
 * iPhone launch screens (`apple-touch-startup-image`): portrait device pixels and the CSS-pixel media query
 * that selects each. iOS shows a blank screen instead when no size matches.
 */
export const SPLASH_SCREENS = [
  { width: 1320, height: 2868, cssWidth: 440, cssHeight: 956, ratio: 3 }, // 16 Pro Max
  { width: 1206, height: 2622, cssWidth: 402, cssHeight: 874, ratio: 3 }, // 16 Pro
  { width: 1290, height: 2796, cssWidth: 430, cssHeight: 932, ratio: 3 }, // 14/15 Pro Max, 15/16 Plus
  { width: 1179, height: 2556, cssWidth: 393, cssHeight: 852, ratio: 3 }, // 14/15 Pro, 15, 16
  { width: 1284, height: 2778, cssWidth: 428, cssHeight: 926, ratio: 3 }, // 12/13 Pro Max, 14 Plus
  { width: 1170, height: 2532, cssWidth: 390, cssHeight: 844, ratio: 3 }, // 12, 13, 14
  { width: 1125, height: 2436, cssWidth: 375, cssHeight: 812, ratio: 3 }, // X, XS, 11 Pro, 12/13 mini
  { width: 1242, height: 2688, cssWidth: 414, cssHeight: 896, ratio: 3 }, // XS Max, 11 Pro Max
  { width: 828, height: 1792, cssWidth: 414, cssHeight: 896, ratio: 2 }, // XR, 11
  { width: 750, height: 1334, cssWidth: 375, cssHeight: 667, ratio: 2 }, // 8, SE 2/3
] as const;

/** File name of a splash screen in `public/splash/`. */
export const splashFile = (screen: (typeof SPLASH_SCREENS)[number]) =>
  `splash/splash-${String(screen.width)}x${String(screen.height)}.png`;

export interface ManifestIcon {
  readonly src: string;
  readonly sizes: string;
  readonly type: string;
  readonly purpose: 'any' | 'maskable' | 'monochrome';
}

export interface WebManifest {
  readonly id: string;
  readonly name: string;
  readonly short_name: string;
  readonly description: string;
  readonly start_url: string;
  readonly scope: string;
  readonly display: 'standalone';
  readonly display_override: readonly ['standalone'];
  readonly orientation: 'portrait';
  readonly background_color: string;
  readonly theme_color: string;
  readonly lang: string;
  readonly dir: 'auto';
  readonly icons: readonly ManifestIcon[];
  readonly launch_handler?: { readonly client_mode: 'focus-existing' };
  readonly shortcuts?: readonly {
    readonly name: string;
    readonly url: string;
    readonly icons: readonly { readonly src: string; readonly sizes: string; readonly type: string }[];
  }[];
}

/**
 * The web app manifest of each PWA (PHASE_00 T0.11): name from `BRAND`, `id`/`scope` `/`, standalone,
 * portrait, canvas colors, any + maskable icons and the monochrome badge; the musalli app adds
 * `launch_handler` (focus the open window) and shortcuts (Qibla, Updates).
 *
 * @param app - `app` (musalli) or `admin`.
 * @returns a JSON-serializable manifest; pure.
 */
export function webManifest(app: BrandMarkApp): WebManifest {
  const png = (src: string, size: number, purpose: ManifestIcon['purpose']): ManifestIcon => ({
    src: `/${src}`,
    sizes: `${String(size)}x${String(size)}`,
    type: 'image/png',
    purpose,
  });
  const base = {
    id: '/',
    name: app === 'admin' ? BRAND.adminName : BRAND.name,
    short_name: app === 'admin' ? BRAND.adminShortName : BRAND.shortName,
    description:
      app === 'admin'
        ? 'Publish timings, notices and campaigns for your masjid.'
        : 'Prayer timings, notices and updates from your masjids. Free, no ads, no account.',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone'],
    orientation: 'portrait',
    background_color: BRAND.colors.background,
    theme_color: BRAND.colors.theme,
    lang: 'en',
    dir: 'auto',
    icons: [
      png(ICON_FILES.any192, 192, 'any'),
      png(ICON_FILES.any512, 512, 'any'),
      png(ICON_FILES.maskable192, 192, 'maskable'),
      png(ICON_FILES.maskable512, 512, 'maskable'),
      png(ICON_FILES.badge, 96, 'monochrome'),
    ],
  } as const satisfies WebManifest;
  if (app === 'admin') return base;
  const shortcutIcon = [{ src: `/${ICON_FILES.any192}`, sizes: '192x192', type: 'image/png' }];
  return {
    ...base,
    launch_handler: { client_mode: 'focus-existing' },
    shortcuts: [
      { name: 'Qibla', url: '/qibla?source=shortcut', icons: shortcutIcon },
      { name: 'Updates', url: '/updates?source=shortcut', icons: shortcutIcon },
    ],
  };
}
