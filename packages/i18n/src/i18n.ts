import i18next, { type BackendModule, type i18n as I18n } from 'i18next';

import { createIcuFormat } from './icu-format.ts';
import { DEFAULT_LOCALE, type Locale, LOCALES } from './locales.ts';

/** Namespaces (09 §2). Feature namespaces are added with their features and loaded per route. */
export const NAMESPACES = [
  'common',
  'errors',
  'onboarding',
  'follow',
  'masjid',
  'content',
  'settings',
  'admin',
  'super',
] as const;
export type Namespace = (typeof NAMESPACES)[number];
/** Loaded up front by every app; feature namespaces (e.g. `admin`) are requested by the app that needs them. */
export const BASE_NAMESPACES: readonly Namespace[] = ['common', 'errors'];
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
export async function createI18n(locale: Locale, namespaces: readonly Namespace[] = BASE_NAMESPACES): Promise<I18n> {
  const instance = i18next.createInstance();
  instance.use(createIcuFormat()).use(lazyJsonBackend);
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
