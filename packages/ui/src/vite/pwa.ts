// `@mc/ui/vite` — the PWA build setup shared by both apps (PHASE_00 T0.11, 01 §5.6). Build-time only (Node).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { BRAND } from '@mc/shared/brand';
import type { BrandMarkApp } from '@mc/shared/brand-mark';
import { ICON_FILES, SPLASH_SCREENS, splashFile, webManifest } from '@mc/shared/pwa';
import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const LOCALES = ['en', 'hi', 'ur', 'te'] as const;
const RTL = new Set(['ur']);
const MANIFEST_FILE = 'manifest.webmanifest';
const OFFLINE_FILE = 'offline.html';

/** Precache = the shell. Per-locale chunks and script fonts are cached on first use instead (09 §6). */
export const PRECACHE = {
  globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'],
  globIgnores: [
    '**/*.map',
    'og.html', // link-preview template shell — served by Caddy for /m/* and /p/* only (DECISIONS #91)
    'assets/common-*.js',
    'assets/errors-*.js',
    'assets/Showcase-*.js', // staging-only showcase chunk (DECISIONS #58) — never downloaded by a normal visit
    'assets/noto-*.woff2',
    'assets/amiri-*.woff2',
    'splash/**',
    ICON_FILES.apple,
  ],
} as const;

/** The offline message in each locale, read from the i18n catalogs (`ui.offline`). */
function offlineTexts(): { locale: string; text: string }[] {
  const require = createRequire(import.meta.url);
  const locales = join(dirname(require.resolve('@mc/i18n')), '..', 'locales');
  return LOCALES.map((locale) => {
    const catalog: unknown = JSON.parse(readFileSync(join(locales, locale, 'common.json'), 'utf8'));
    const ui = typeof catalog === 'object' && catalog !== null && 'ui' in catalog ? catalog.ui : undefined;
    const text = typeof ui === 'object' && ui !== null && 'offline' in ui ? ui.offline : undefined;
    if (typeof text !== 'string') throw new Error(`mcPwa: ui.offline missing in ${locale}`);
    return { locale, text };
  });
}

const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/**
 * The offline fallback page (served by the SW when even the shell is unavailable): the app stylesheet, the
 * brand mark and the offline message in all four languages. No inline script or style (strict CSP, 04 §7).
 */
export function offlineHtml(app: BrandMarkApp, stylesheet: string | undefined): string {
  const name = app === 'admin' ? BRAND.adminName : BRAND.name;
  const lines = offlineTexts()
    .map(
      ({ locale, text }) =>
        `<p lang="${locale}" dir="${RTL.has(locale) ? 'rtl' : 'ltr'}" class="type-body text-text-secondary">${escapeHtml(text)}</p>`,
    )
    .join('\n      ');
  return `<!doctype html>
<html lang="en" dir="ltr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="${BRAND.colors.theme}" />
    <title>${escapeHtml(name)}</title>
    ${stylesheet ? `<link rel="stylesheet" href="/${stylesheet}" />` : ''}
  </head>
  <body>
    <main class="flex min-h-dvh flex-col items-center justify-center gap-3 px-screen text-center">
      <img src="/${ICON_FILES.any192}" alt="" width="72" height="72" />
      <h1 class="type-title2 text-text">${escapeHtml(name)}</h1>
      ${lines}
    </main>
  </body>
</html>
`;
}

/** `<head>` tags: manifest, favicon, Apple home-screen tags and launch screens. */
export function headTags(app: BrandMarkApp): string {
  const shortName = app === 'admin' ? BRAND.adminShortName : BRAND.shortName;
  const splash = SPLASH_SCREENS.map(
    (screen) =>
      `<link rel="apple-touch-startup-image" media="(device-width: ${String(screen.cssWidth)}px) and (device-height: ${String(
        screen.cssHeight,
      )}px) and (-webkit-device-pixel-ratio: ${String(screen.ratio)}) and (orientation: portrait)" href="/${splashFile(screen)}" />`,
  );
  return [
    `<link rel="manifest" href="/${MANIFEST_FILE}" />`,
    `<link rel="icon" href="/${ICON_FILES.favicon}" type="image/svg+xml" />`,
    `<link rel="apple-touch-icon" href="/${ICON_FILES.apple}" />`,
    '<meta name="mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
    `<meta name="apple-mobile-web-app-title" content="${escapeHtml(shortName)}" />`,
    ...splash,
  ].join('\n    ');
}

export interface McPwaOptions {
  readonly app: BrandMarkApp;
  /** Release id stamped into `<meta name="mc-release">` (default `MC_RELEASE` env or `dev`). */
  readonly release?: string;
}

/**
 * Vite plugins for a PWA: vite-plugin-pwa with our own service worker (`src/sw/sw.ts`, `injectManifest`),
 * the manifest from `webManifest()`, the offline page and the `<head>` tags. Registration is done by the app
 * (`useServiceWorker` in `@mc/ui/pwa`), never auto-injected.
 */
export function mcPwa({ app, release = process.env['MC_RELEASE'] ?? 'dev' }: McPwaOptions): Plugin[] {
  const assets: Plugin = {
    name: 'mc-pwa-assets',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html.replace(
          '</head>',
          `    ${headTags(app)}\n    <meta name="mc-release" content="${escapeHtml(release)}" />\n  </head>`,
        ),
    },
    generateBundle(_options, bundle) {
      this.emitFile({
        type: 'asset',
        fileName: MANIFEST_FILE,
        source: `${JSON.stringify(webManifest(app), null, 2)}\n`,
      });
      const stylesheet = Object.values(bundle).find(
        (file) => file.type === 'asset' && file.fileName.startsWith('assets/') && file.fileName.endsWith('.css'),
      )?.fileName;
      this.emitFile({ type: 'asset', fileName: OFFLINE_FILE, source: offlineHtml(app, stylesheet) });
    },
  };
  return [
    assets,
    ...VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: false,
      includeManifestIcons: false,
      injectManifest: {
        globPatterns: [...PRECACHE.globPatterns],
        globIgnores: [...PRECACHE.globIgnores],
        // The shell's largest file is the entry chunk (~0.5 MB unminified gzip-free); fonts are larger.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ];
}
