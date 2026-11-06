import './types.ts';

import type { i18n as I18n } from 'i18next';
import { createContext, type ReactNode, use, useCallback, useEffect, useMemo, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';

import { applyDocumentLocale, persistLocaleMirror } from './document.ts';
import { type Formatters, formatters } from './format.ts';
import { createI18n, type Namespace } from './i18n.ts';
import { DEFAULT_LOCALE, isLocale, type Locale } from './locales.ts';

interface LocaleContextValue {
  readonly locale: Locale;
  readonly format: Formatters;
  /** Switches language instantly (no reload): loads the namespaces, flips `<html lang dir>`, mirrors it. */
  readonly setLocale: (locale: Locale) => Promise<void>;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/** Reads the boot locale that `/boot.js` already applied to `<html lang>` (falls back to `en`). */
export function initialDocumentLocale(doc: Document = document): Locale {
  const lang = doc.documentElement.lang;
  return isLocale(lang) ? lang : DEFAULT_LOCALE;
}

export interface I18nProviderProps {
  readonly children: ReactNode;
  readonly initialLocale?: Locale;
  /** Shown while the first namespaces load (one tiny JSON request). */
  readonly fallback?: ReactNode;
  /** Pre-built instance (tests). */
  readonly instance?: I18n;
  /** Namespaces to load before rendering (default: `common` + `errors`; the admin app adds `admin`). */
  readonly namespaces?: readonly Namespace[];
}

/** Provides i18next + the locale switcher + memoized formatters to the app. */
export function I18nProvider({ children, initialLocale, fallback = null, instance, namespaces }: I18nProviderProps) {
  const [i18n, setI18n] = useState<I18n | null>(instance ?? null);
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? initialDocumentLocale());

  useEffect(() => {
    if (i18n) return;
    let cancelled = false;
    void createI18n(locale, namespaces).then((created) => {
      if (!cancelled) setI18n(created);
    });
    return () => {
      cancelled = true;
    };
    // The instance is created once; later locale changes go through setLocale.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-time init
  }, []);

  const setLocale = useCallback(
    async (next: Locale) => {
      if (!i18n) return;
      await i18n.changeLanguage(next);
      applyDocumentLocale(next);
      persistLocaleMirror(next);
      setLocaleState(next);
    },
    [i18n],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, format: formatters(locale), setLocale }),
    [locale, setLocale],
  );

  if (!i18n) return fallback;
  return (
    <I18nextProvider i18n={i18n}>
      <LocaleContext value={value}>{children}</LocaleContext>
    </I18nextProvider>
  );
}

export interface LocaleScopeProps {
  readonly locale: Locale;
  readonly children: ReactNode;
  /** Namespaces the subtree needs before it renders (it never shows raw keys). */
  readonly namespaces: readonly Namespace[];
  /** Shown until the first locale is ready. */
  readonly fallback?: ReactNode;
}

const noSwitch = (): Promise<void> => Promise.resolve();

/**
 * A subtree in another language than the app's (the admin preview shows how each language sees a post — 07 B5): its
 * own i18next instance per locale and its own formatters; `<html lang dir>` is untouched, so the caller marks the
 * subtree with `lang`/`dir`. A locale change keeps the previous language on screen until the next one has loaded.
 * `setLocale` inside the scope does nothing — the `locale` prop decides.
 */
export function LocaleScope({ locale, children, namespaces, fallback = null }: LocaleScopeProps) {
  const [instances] = useState(() => new Map<Locale, Promise<I18n>>());
  const [shown, setShown] = useState<{ readonly locale: Locale; readonly i18n: I18n } | null>(null);
  const nsKey = namespaces.join(',');

  useEffect(() => {
    let active = true;
    let pending = instances.get(locale);
    if (!pending) {
      pending = createI18n(locale, namespaces);
      instances.set(locale, pending);
    }
    void pending.then((i18n) => {
      if (active) setShown({ locale, i18n });
    });
    return () => {
      active = false;
    };
    // `namespaces` is read through its joined key (callers pass literal arrays).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nsKey stands for namespaces
  }, [instances, locale, nsKey]);

  const value = useMemo<LocaleContextValue | null>(
    () => (shown ? { locale: shown.locale, format: formatters(shown.locale), setLocale: noSwitch } : null),
    [shown],
  );

  if (!shown || !value) return fallback;
  return (
    <I18nextProvider i18n={shown.i18n}>
      <LocaleContext value={value}>{children}</LocaleContext>
    </I18nextProvider>
  );
}

/** Current locale, formatters and switcher. Must be used inside `<I18nProvider>`. */
export function useLocale(): LocaleContextValue {
  const value = use(LocaleContext);
  if (!value) throw new Error('useLocale() must be used inside <I18nProvider>');
  return value;
}

export { useTranslation };

/**
 * Isolates Latin-only runs (times, amounts, VPAs, codes) inside RTL text so they never reorder (09 §5).
 */
export function Bdi({ children }: { readonly children: ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}

/** "₹1,00,000" in `<bdi>`. */
export function Money({ paise }: { readonly paise: number }) {
  return <Bdi>{useLocale().format.money(paise)}</Bdi>;
}

/** A Hijri date as numbers (`@mc/domain/hijri` computes it: Umm al-Qura + offset + after-Maghrib rollover). */
export interface HijriParts {
  readonly year: number;
  /** 1 = Muharram … 12 = Dhu al-Hijjah. */
  readonly month: number;
  readonly day: number;
}

const HIJRI_MONTHS = [
  'hijri.months.m1',
  'hijri.months.m2',
  'hijri.months.m3',
  'hijri.months.m4',
  'hijri.months.m5',
  'hijri.months.m6',
  'hijri.months.m7',
  'hijri.months.m8',
  'hijri.months.m9',
  'hijri.months.m10',
  'hijri.months.m11',
  'hijri.months.m12',
] as const;

/**
 * Formats Hijri dates with our own month names per locale (PROGRESS F13: Intl's are English in `te` and oddly ordered
 * in `hi`); the pattern `hijri.date` lets each language order day, month and year. Digits stay Latin (09 §4).
 *
 * @returns `(date) => "16 Rabi’ al-Akhir 1448"`; throws RangeError for a month outside 1–12.
 */
export function useHijriLabel(): (date: HijriParts) => string {
  const { t } = useTranslation();
  return (date) => {
    const month = HIJRI_MONTHS[date.month - 1];
    if (!month) throw new RangeError('useHijriLabel(): month must be 1–12');
    return t('hijri.date', { day: String(date.day), month: t(month), year: String(date.year) });
  };
}

/** "16 Rabi’ al-Akhir 1448". */
export function HijriDate({ value }: { readonly value: HijriParts }) {
  return <>{useHijriLabel()(value)}</>;
}

/** "5:15 AM" in `<bdi>` from a wall-clock "HH:mm". */
export function Time({ value }: { readonly value: string }) {
  return <Bdi>{useLocale().format.time(value).text}</Bdi>;
}
