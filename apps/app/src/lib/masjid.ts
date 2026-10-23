// Masjid display helpers shared by every screen that shows a masjid.
import type { Locale } from '@mc/i18n/locales';

interface Named {
  readonly name: string;
  readonly nameI18n: {
    readonly hi?: string | undefined;
    readonly ur?: string | undefined;
    readonly te?: string | undefined;
  };
}

/** The masjid's name in the app language when the super admin entered one, else its (English) name. */
export function masjidName(masjid: Named, locale: Locale): string {
  if (locale === 'en') return masjid.name;
  const localized = masjid.nameI18n[locale];
  return localized !== undefined && localized.trim() !== '' ? localized : masjid.name;
}

/** "Area, City" — the short location line under a masjid name. */
export function masjidPlace(masjid: { readonly area: string; readonly city: string }): string {
  return [masjid.area, masjid.city].filter((part) => part.trim() !== '').join(', ');
}
