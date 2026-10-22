import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { mcLocaleBoot } from '@mc/i18n/vite';
import { BRAND } from '@mc/shared/brand';
import { configureZodForCsp } from '@mc/shared/browser';
import { CLIENT_ENV_PREFIX, parseClientEnv } from '@mc/shared/env';
import { fontBaseName, LOCALE_PRELOAD_FONTS } from '@mc/ui/fonts';
import { mcPwa } from '@mc/ui/vite';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/** Active-locale UI fonts preloaded by /boot.js (09 §6). */
const preloadFonts = Object.fromEntries(
  Object.entries(LOCALE_PRELOAD_FONTS).map(([locale, keys]) => [locale, keys.map(fontBaseName)]),
);

/** Fills `%MC_APP_NAME%` / `%MC_THEME_COLOR%` in index.html from brand.ts (single source; no hex in apps/**). */
const brandHtml = (): Plugin => ({
  name: 'mc-brand-html',
  transformIndexHtml: (html) =>
    html.replaceAll('%MC_APP_NAME%', BRAND.name).replaceAll('%MC_THEME_COLOR%', BRAND.colors.theme),
});

/**
 * Link previews (03 §3, DECISIONS #91): `og.html` = the built shell + one Caddy template action that pulls the
 * HTML-escaped OpenGraph tags for `/m/:code` and `/p/:publicId` from api-public. Caddy runs it as a template for those
 * two (strictly matched) paths only; the action reads only the regexp captures of that match.
 */
export const OG_TEMPLATE_ACTION =
  '{{httpInclude (printf "/api/v1/og/%s/%s" (placeholder "http.regexp.og.1") (placeholder "http.regexp.og.2"))}}';
const ogShell = (): Plugin => ({
  name: 'mc-og-shell',
  apply: 'build',
  enforce: 'post',
  writeBundle(options) {
    const dir = options.dir ?? 'dist';
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    // Caddy would treat any "{{" in the shell as template syntax.
    if (html.includes('{{')) throw new Error('mc-og-shell: index.html must not contain "{{"');
    if (!html.includes('</head>')) throw new Error('mc-og-shell: index.html has no </head>');
    writeFileSync(join(dir, 'og.html'), html.replace('</head>', `${OG_TEMPLATE_ACTION}\n</head>`));
  },
});

/** Musalli PWA (apps/app). Dev: http://localhost:5173, `/api` proxied to api-public (01 §6). */
export default defineConfig(({ mode }) => {
  // Validate every VITE_* variable at build/dev start: only VITE_PUBLIC_* may exist (04 §11, CLAUDE.md §8).
  parseClientEnv('app', loadEnv(mode, import.meta.dirname, 'VITE_'));

  return {
    envPrefix: CLIENT_ENV_PREFIX,
    plugins: [
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      tailwindcss(),
      brandHtml(),
      ogShell(),
      // Zod must be jitless before any schema is built, or its eval probe trips Trusted Types (04 §7).
      mcLocaleBoot({ preloadFonts, before: [configureZodForCsp] }),
      ...mcPwa({ app: 'app' }),
    ],
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: 'http://127.0.0.1:8787' } },
    },
    preview: { port: 4173, strictPort: true },
    build: {
      target: 'es2022',
      // Hidden source maps: generated for Sentry upload in CI, never referenced or served (T0.13).
      sourcemap: 'hidden',
      // No inline polyfill script → strict CSP without 'unsafe-inline' (04 §7, T0.5).
      modulePreload: { polyfill: false },
    },
  };
});
