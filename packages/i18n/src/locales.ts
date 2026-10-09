/** The four supported locales (09 §1). `en` is the source language for every key. */
export const LOCALES = ['en', 'hi', 'ur', 'te'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Locales written right-to-left. Urdu is fully mirrored (09 §5). */
export const RTL_LOCALES: readonly Locale[] = ['ur'];

/** `Intl` locale per UI locale; numbers and times always use Latin digits (`-u-nu-latn`, 09 §4). */
export const INTL_LOCALE: Readonly<Record<Locale, string>> = {
  en: 'en-IN',
  hi: 'hi-IN',
  ur: 'ur-IN',
  te: 'te-IN',
};

/** Each language's own name, shown in its own script everywhere (language picker, onboarding). */
export const NATIVE_NAME: Readonly<Record<Locale, string>> = {
  en: 'English',
  hi: 'हिन्दी',
  ur: 'اردو',
  te: 'తెలుగు',
};

/**
 * `localStorage` key mirroring the chosen locale so `<html lang dir>` can be set synchronously before
 * the first paint (09 §5). IndexedDB (Phase 2 device store) remains the source of truth.
 */
export const LOCALE_STORAGE_KEY = 'mc.locale';

/** Type guard for untrusted input (storage, URLs, API). */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Text direction of a locale. */
export function directionOf(locale: Locale): 'ltr' | 'rtl' {
  return RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
}

/**
 * Best match of the browser's preferred languages among ours (09 §1): `hi-IN` → `hi`, `ur-*` → `ur`,
 * `te-*` → `te`, otherwise `en`. Only the primary subtag is compared.
 *
 * @param languages - `navigator.languages` (most preferred first).
 * @returns a supported locale; never throws.
 */
export function matchLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}
