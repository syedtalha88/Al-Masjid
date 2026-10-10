import type { Plugin } from 'vite';

import { BOOT_SCRIPT, bootScript } from './boot.ts';

const BOOT_PATH = '/boot.js';

export interface LocaleBootOptions {
  /**
   * Font files to preload per locale, as emitted base names without hash/extension
   * (e.g. `inter-latin-wght-normal`) — supplied by `@mc/ui/fonts` (09 §6).
   */
  readonly preloadFonts?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Resolves preload base names to the hashed asset URLs in the bundle.
 *
 * @throws when a configured font is missing from the build (a renamed file must not silently stop preloading).
 */
export function resolveFontPreloads(
  fileNames: readonly string[],
  preloadFonts: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [locale, bases] of Object.entries(preloadFonts)) {
    result[locale] = bases.map((base) => {
      const match = fileNames.find((name) => new RegExp(`(^|/)${base}-[\\w-]{6,}\\.woff2$`).test(name));
      if (!match) throw new Error(`mcLocaleBoot: font "${base}" (locale ${locale}) is not in the build output`);
      return `/${match}`;
    });
  }
  return result;
}

/**
 * Serves and emits `/boot.js` (pre-paint `<html lang dir>` + active-locale font preloads — 09 §5–6) and
 * injects a render-blocking `<script src="/boot.js">` as the first element of `<head>`. External file instead
 * of inline code so the CSP needs no `'unsafe-inline'` or hash (04 §7). Cache: Caddy serves it `no-cache`.
 */
export function mcLocaleBoot(options: LocaleBootOptions = {}): Plugin {
  return {
    name: 'mc-locale-boot',
    // After the CSS pipeline has emitted the font assets.
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use(BOOT_PATH, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(BOOT_SCRIPT);
      });
    },
    generateBundle(_outputOptions, bundle) {
      const preloads = options.preloadFonts ? resolveFontPreloads(Object.keys(bundle), options.preloadFonts) : {};
      this.emitFile({ type: 'asset', fileName: 'boot.js', source: bootScript(preloads) });
    },
    transformIndexHtml: () => [{ tag: 'script', attrs: { src: BOOT_PATH }, injectTo: 'head-prepend' }],
  };
}
