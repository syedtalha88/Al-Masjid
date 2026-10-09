import type { Plugin } from 'vite';

import { BOOT_SCRIPT } from './boot.ts';

const BOOT_PATH = '/boot.js';

/**
 * Serves and emits `/boot.js` (pre-paint `<html lang dir>` — 09 §5) and injects a render-blocking
 * `<script src="/boot.js">` as the first element of `<head>`. External file instead of inline code so the
 * CSP needs no `'unsafe-inline'` or hash (04 §7). Cache: Caddy serves it `no-cache` (entry point).
 */
export function mcLocaleBoot(): Plugin {
  return {
    name: 'mc-locale-boot',
    configureServer(server) {
      server.middlewares.use(BOOT_PATH, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(BOOT_SCRIPT);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'boot.js', source: BOOT_SCRIPT });
    },
    transformIndexHtml: () => [{ tag: 'script', attrs: { src: BOOT_PATH }, injectTo: 'head-prepend' }],
  };
}
