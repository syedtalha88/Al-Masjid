import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Plugin } from 'vite';

import { bootScript } from './boot.ts';
import { PRECOMPILED_MARK } from './icu-format.ts';
import { draftLegalDocs } from './legal-parse.ts';

const BOOT_PATH = '/boot.js';

export interface LocaleBootOptions {
  /**
   * Font files to preload per locale, as emitted base names without hash/extension
   * (e.g. `inter-latin-wght-normal`) — supplied by `@mc/ui/fonts` (09 §6).
   */
  readonly preloadFonts?: Readonly<Record<string, readonly string[]>>;
  /**
   * Self-contained functions run first in `/boot.js` — before any module script, so before any chunk is evaluated
   * (see `bootScript`). Used for `configureZodForCsp` (04 §7).
   */
  readonly before?: readonly (() => void)[];
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
 * Serves and emits `/boot.js` (optional `before` functions, then pre-paint `<html lang dir>` + active-locale font
 * preloads — 09 §5–6) and
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
        res.end(bootScript({}, options.before));
      });
    },
    generateBundle(_outputOptions, bundle) {
      const preloads = options.preloadFonts ? resolveFontPreloads(Object.keys(bundle), options.preloadFonts) : {};
      this.emitFile({ type: 'asset', fileName: 'boot.js', source: bootScript(preloads, options.before) });
    },
    transformIndexHtml: () => [{ tag: 'script', attrs: { src: BOOT_PATH }, injectTo: 'head-prepend' }],
  };
}

/** Locale catalogue files (`packages/i18n/locales/<lng>/<ns>.json`). */
const CATALOGUE = /[\\/]packages[\\/]i18n[\\/]locales[\\/][a-z]{2}[\\/][\w.-]+\.json$/;
/**
 * Locale files read as plain text, never through i18next: the ready-made dua messages (`dua-messages.ts` — no ICU
 * arguments, checked by its test) fill a text box as they are; the push words (`push-text.ts`) go into notifications
 * as they are (the musalli service worker's fallback text).
 */
const PLAIN_TEXT = /[\\/](dua-messages|push)\.json$/;

/** Replaces every string leaf of a catalogue with the result of `convert`. */
export function mapCatalogueStrings(value: unknown, convert: (message: string) => string): unknown {
  if (typeof value === 'string') return convert(value);
  if (Array.isArray(value)) return value.map((item) => mapCatalogueStrings(item, convert));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapCatalogueStrings(item, convert)]));
  }
  return value;
}

const PARSER = '@formatjs/icu-messageformat-parser';
/** The one module that keeps the real parser: notice templates arrive at runtime (runtime-message.ts, lazy chunk). */
const RUNTIME_MESSAGE = /[\\/]packages[\\/]i18n[\\/]src[\\/]runtime-message\.ts$/;

/**
 * Production builds only (PROGRESS F14, DECISIONS #92): every catalogue string becomes its ICU AST (marked with
 * `PRECOMPILED_MARK`), and the FormatJS message parser is replaced by its `no-parser` stub — the parser (≈ 10 kB gzip)
 * is not in the app's initial code. `icu-format.ts` formats the ASTs. Only `runtime-message.ts` (lazy, for notice
 * templates from the API) imports the real parser. Dev keeps plain strings and the parser everywhere.
 */
export function mcIcuPrecompile(): Plugin {
  return {
    name: 'mc-icu-precompile',
    apply: 'build',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source !== PARSER || (importer !== undefined && RUNTIME_MESSAGE.test(importer.split('?')[0] ?? ''))) {
        return null;
      }
      return this.resolve(`${PARSER}/no-parser.js`, importer, { ...options, skipSelf: true });
    },
    async transform(code, id) {
      const path = id.split('?')[0] ?? '';
      if (!CATALOGUE.test(path) || PLAIN_TEXT.test(path)) return null;
      const { parse } = await import('@formatjs/icu-messageformat-parser');
      const catalogue: unknown = JSON.parse(code);
      const compiled = mapCatalogueStrings(
        catalogue,
        (message) => PRECOMPILED_MARK + JSON.stringify(parse(message, { ignoreTag: true, shouldParseSkeletons: true })),
      );
      return { code: JSON.stringify(compiled), map: null };
    },
  };
}

/** Reads every legal document under `dir` (`<locale>/<name>.md`) as path → text. */
export function readLegalFiles(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const locale of readdirSync(dir)) {
    for (const name of readdirSync(join(dir, locale)).filter((file) => file.endsWith('.md'))) {
      files[`${locale}/${name}`] = readFileSync(join(dir, locale, name), 'utf8');
    }
  }
  return files;
}

/**
 * The production gate for legal texts (05 §10, PHASE_08 T8.6): when the build is for production
 * (`MC_BUILD_ENV=production`, set only by the production web image), any document still marked `status: draft` fails
 * the build with the list of files. Other builds pass (staging and local show the DRAFT banner instead).
 *
 * @throws Error listing the drafts, in production mode.
 */
export function assertLegalReady(
  env: { readonly MC_BUILD_ENV?: string | undefined },
  files: Readonly<Record<string, string>>,
): void {
  if (env.MC_BUILD_ENV !== 'production') return;
  const drafts = draftLegalDocs(files);
  if (drafts.length > 0) {
    throw new Error(
      `Legal texts still marked draft cannot ship to production (05 §10): ${drafts.join(', ')}. ` +
        'Set `status: reviewed` after the legal review.',
    );
  }
}

/** Vite plugin wrapper of {@link assertLegalReady} over `packages/i18n/legal` (runs at build start). */
export function mcLegalGate(): Plugin {
  return {
    name: 'mc-legal-gate',
    apply: 'build',
    buildStart() {
      assertLegalReady(process.env, readLegalFiles(join(import.meta.dirname, '..', 'legal')));
    },
  };
}
