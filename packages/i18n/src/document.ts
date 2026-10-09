import { directionOf, type Locale, LOCALE_STORAGE_KEY } from './locales.ts';

/**
 * Applies a locale to the document at runtime (no reload): `<html lang dir>` flip the whole layout because
 * the UI uses logical properties only (09 §5).
 */
export function applyDocumentLocale(locale: Locale, doc: Document = document): void {
  doc.documentElement.lang = locale;
  doc.documentElement.dir = directionOf(locale);
}

/**
 * Mirrors the locale into `localStorage` for the synchronous boot script. Best effort: storage may be
 * blocked (private mode) — the app still works, it just boots in the browser language next time.
 */
export function persistLocaleMirror(locale: Locale, storage?: Storage): void {
  try {
    // Reading `localStorage` itself can throw (sandboxed frames), so it happens inside the try.
    (storage ?? globalThis.localStorage).setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage unavailable — nothing to do.
  }
}
