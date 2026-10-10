import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, LOCALES, RTL_LOCALES } from './locales.ts';

/** A `<link>` element as far as the boot script uses it. */
export interface BootLink {
  rel: string;
  as: string;
  type: string;
  crossOrigin: string | null;
  href: string;
}

/** Minimal environment the boot function touches (injectable for tests). */
export interface BootEnvironment {
  readonly localStorage: { getItem(key: string): string | null } | undefined;
  readonly navigator: { readonly languages?: readonly string[] | undefined } | undefined;
  readonly document: {
    readonly documentElement: { lang: string; dir: string };
    readonly head?: { appendChild(node: BootLink): unknown } | null;
    createElement?(tag: 'link'): BootLink;
  };
}

/** Font files to preload per locale: locale → absolute URLs (built by the Vite plugin from hashed assets). */
export type FontPreloads = Readonly<Record<string, readonly string[]>>;

/**
 * Sets `<html lang dir>` before the first paint (09 §5) and preloads the active locale's UI fonts (09 §6).
 * Runs as a classic, render-blocking external script (`/boot.js`) because the CSP forbids inline scripts
 * (04 §7, PROGRESS F7). Must stay self-contained — it is serialized with `Function.prototype.toString` — and
 * never throw (storage can be blocked).
 *
 * Order: stored choice (`mc.locale`) → browser languages → default.
 */
export function bootDocumentLocale(
  env: BootEnvironment,
  storageKey: string,
  supported: readonly string[],
  rtl: readonly string[],
  fallback: string,
  preloads?: FontPreloads,
): string {
  let locale = fallback;
  try {
    const stored = env.localStorage?.getItem(storageKey);
    if (stored !== null && stored !== undefined && supported.includes(stored)) {
      locale = stored;
    } else {
      for (const tag of env.navigator?.languages ?? []) {
        const primary = tag.toLowerCase().split(/[-_]/)[0] ?? '';
        if (supported.includes(primary)) {
          locale = primary;
          break;
        }
      }
    }
  } catch {
    locale = fallback;
  }
  env.document.documentElement.lang = locale;
  env.document.documentElement.dir = rtl.includes(locale) ? 'rtl' : 'ltr';
  try {
    const head = env.document.head;
    for (const href of preloads?.[locale] ?? []) {
      if (!head || !env.document.createElement) break;
      const link = env.document.createElement('link');
      link.rel = 'preload';
      link.as = 'font';
      link.type = 'font/woff2';
      // Fonts are always fetched in CORS mode; a preload without it would be fetched twice.
      link.crossOrigin = 'anonymous';
      link.href = href;
      head.appendChild(link);
    }
  } catch {
    // Preloading is an optimization only.
  }
  return locale;
}

/**
 * The `/boot.js` source served by both apps (see vite-plugin.ts).
 *
 * @param preloads - locale → font URLs to preload; empty in dev (unhashed sources are not worth it).
 */
export function bootScript(preloads: FontPreloads = {}): string {
  const args = [LOCALE_STORAGE_KEY, LOCALES, RTL_LOCALES, DEFAULT_LOCALE, preloads].map((value) =>
    JSON.stringify(value),
  );
  return `(${bootDocumentLocale.toString()})(window, ${args.join(', ')});\n`;
}

/** Boot script without preloads (dev server). */
export const BOOT_SCRIPT = bootScript();
