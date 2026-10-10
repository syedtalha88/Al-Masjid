import { mcLocaleBoot } from '@mc/i18n/vite';
import { BRAND } from '@mc/shared/brand';
import { CLIENT_ENV_PREFIX, parseClientEnv } from '@mc/shared/env';
import { fontBaseName, LOCALE_PRELOAD_FONTS } from '@mc/ui/fonts';
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
    html.replaceAll('%MC_APP_NAME%', BRAND.adminName).replaceAll('%MC_THEME_COLOR%', BRAND.colors.theme),
});

/** Admin + Super Admin PWA (apps/admin). Dev: http://localhost:5174, `/api` proxied to api-admin (01 §6). */
export default defineConfig(({ mode }) => {
  // Validate every VITE_* variable at build/dev start: only VITE_PUBLIC_* may exist (04 §11, CLAUDE.md §8).
  parseClientEnv('admin', loadEnv(mode, import.meta.dirname, 'VITE_'));

  return {
    envPrefix: CLIENT_ENV_PREFIX,
    plugins: [
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      tailwindcss(),
      brandHtml(),
      mcLocaleBoot({ preloadFonts }),
    ],
    server: {
      port: 5174,
      strictPort: true,
      proxy: { '/api': { target: 'http://127.0.0.1:8788' } },
    },
    preview: { port: 4174, strictPort: true },
    build: {
      target: 'es2022',
      // Hidden source maps: generated for Sentry upload in CI, never referenced or served (T0.13).
      sourcemap: 'hidden',
      // No inline polyfill script → strict CSP without 'unsafe-inline' (04 §7, T0.5).
      modulePreload: { polyfill: false },
    },
  };
});
