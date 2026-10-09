// Locales (en, hi, ur, te), i18next setup, formatters and RTL helpers (09_I18N).
// React bindings: '@mc/i18n/react'; Vite boot-script plugin: '@mc/i18n/vite'.
import './types.ts';

export { applyDocumentLocale, persistLocaleMirror } from './document.ts';
export { type DateStyle, DISPLAY_TIME_ZONE, type Formatters, formatters, type TimeParts } from './format.ts';
export { createI18n, DEFAULT_NAMESPACE, type Namespace, NAMESPACES } from './i18n.ts';
export {
  DEFAULT_LOCALE,
  directionOf,
  INTL_LOCALE,
  isLocale,
  type Locale,
  LOCALE_STORAGE_KEY,
  LOCALES,
  matchLocale,
  NATIVE_NAME,
  RTL_LOCALES,
} from './locales.ts';
export type { Resources } from './types.ts';
