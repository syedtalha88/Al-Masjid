import i18next, { type BackendModule, type i18n as I18n } from 'i18next';
import ICU from 'i18next-icu';

import { DEFAULT_LOCALE, type Locale, LOCALES } from './locales.ts';

/** Namespaces (09 §2). Feature namespaces are added with their features and loaded per route. */
export const NAMESPACES = ['common', 'errors'] as const;
export type Namespace = (typeof NAMESPACES)[number];
export const DEFAULT_NAMESPACE: Namespace = 'common';

/**
 * Every locale/namespace JSON file as a lazy chunk (Vite splits each into its own file), so a device only
 * downloads its own language (09 §2, 01 §9).
 */
const LOADERS = import.meta.glob<{ default: Record<string, unknown> }>('../locales/*/*.json');

/** i18next backend that loads `locales/<lng>/<ns>.json` through the lazy chunks above. */
const lazyJsonBackend: BackendModule = {
  type: 'backend',
  init: () => undefined,
  read(language, namespace, callback) {
    const load = LOADERS[`../locales/${language}/${namespace}.json`];
    if (!load) {
      callback(new Error(`missing locale file ${language}/${namespace}`), false);
      return;
    }
    load().then(
      (module) => {
        callback(null, module.default);
      },
      (error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)), false);
      },
    );
  },
};

/**
 * Creates a dedicated i18next instance (ICU MessageFormat for plurals/select — 09 §2).
 *
 * @param locale - initial UI locale.
 * @param namespaces - namespaces to load up front (others load on demand via `useTranslation(ns)`).
 * @returns the initialized instance (resolves after the initial namespaces are loaded).
 */
export async function createI18n(locale: Locale, namespaces: readonly Namespace[] = NAMESPACES): Promise<I18n> {
  const instance = i18next.createInstance();
  instance.use(ICU).use(lazyJsonBackend);
  await instance.init({
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...LOCALES],
    nonExplicitSupportedLngs: false,
    load: 'currentOnly',
    ns: [...namespaces],
    defaultNS: DEFAULT_NAMESPACE,
    // React escapes output; ICU params are plain values.
    interpolation: { escapeValue: false },
    returnEmptyString: false,
    react: { useSuspense: false },
  });
  return instance;
}
