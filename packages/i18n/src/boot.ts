import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, LOCALES, RTL_LOCALES } from './locales.ts';

/** Minimal environment the boot function touches (injectable for tests). */
export interface BootEnvironment {
  readonly localStorage: { getItem(key: string): string | null } | undefined;
  readonly navigator: { readonly languages?: readonly string[] | undefined } | undefined;
  readonly document: { readonly documentElement: { lang: string; dir: string } };
}

/**
 * Sets `<html lang dir>` before the first paint (09 §5). Runs as a classic, render-blocking external script
 * (`/boot.js`) because the CSP forbids inline scripts (04 §7, PROGRESS F7). Must stay self-contained — it
 * is serialized with `Function.prototype.toString` — and never throw (storage can be blocked).
 *
 * Order: stored choice (`mc.locale`) → browser languages → default.
 */
export function bootDocumentLocale(
  env: BootEnvironment,
  storageKey: string,
  supported: readonly string[],
  rtl: readonly string[],
  fallback: string,
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
  return locale;
}

/** The `/boot.js` source served by both apps (see vite-plugin.ts). */
export const BOOT_SCRIPT = `(${bootDocumentLocale.toString()})(window, ${JSON.stringify(LOCALE_STORAGE_KEY)}, ${JSON.stringify(
  LOCALES,
)}, ${JSON.stringify(RTL_LOCALES)}, ${JSON.stringify(DEFAULT_LOCALE)});\n`;
