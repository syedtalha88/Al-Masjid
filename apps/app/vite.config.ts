import { BRAND } from '@mc/shared/brand';
import { CLIENT_ENV_PREFIX, parseClientEnv } from '@mc/shared/env';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/** Fills `%MC_APP_NAME%` / `%MC_THEME_COLOR%` in index.html from brand.ts (single source; no hex in apps/**). */
const brandHtml = (): Plugin => ({
  name: 'mc-brand-html',
  transformIndexHtml: (html) =>
    html.replaceAll('%MC_APP_NAME%', BRAND.name).replaceAll('%MC_THEME_COLOR%', BRAND.colors.theme),
});

/** Musalli PWA (apps/app). Dev: http://localhost:5173, `/api` proxied to api-public (01 §6). */
export default defineConfig(({ mode }) => {
  // Validate every VITE_* variable at build/dev start: only VITE_PUBLIC_* may exist (04 §11, CLAUDE.md §8).
  parseClientEnv('app', loadEnv(mode, import.meta.dirname, 'VITE_'));

  return {
    envPrefix: CLIENT_ENV_PREFIX,
    plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), brandHtml()],
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
