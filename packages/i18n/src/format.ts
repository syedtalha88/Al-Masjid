import { INTL_LOCALE, type Locale } from './locales.ts';

/**
 * Locale-aware formatting (09 §4). Every formatter is memoized per locale. Rules:
 * - Latin digits in every locale (`numberingSystem: 'latn'`).
 * - Money: `₹` + Indian grouping (`₹1,00,000`) in **every** locale, no decimals unless paise are non-zero.
 *   `ur-IN` would otherwise group as `₹100,000`, so amounts always use the `en-IN` pattern (DECISIONS #38).
 * - Times: 12-hour; a Latin-script day period is upper-cased to match the references ("5:15 AM"). Spacing is
 *   normalized to one no-break space (ICU varies: U+202F in en-IN, U+0020 elsewhere) so "AM" never wraps alone.
 * - Display time zone: Asia/Kolkata.
 * Callers wrap Latin-only output (times, amounts) in `<bdi>` inside RTL text (09 §5) — see `react.tsx`.
 */

export const DISPLAY_TIME_ZONE = 'Asia/Kolkata';
const MONEY_LOCALE = 'en-IN';
const RELATIVE_MAX_DAYS = 6;

export interface TimeParts {
  /** Full text, e.g. "5:15 AM". */
  readonly text: string;
  /** Clock part without the day period, e.g. "5:15" (prayer strip shows time and AM/PM on separate lines). */
  readonly time: string;
  /** Day period, e.g. "AM"; empty when the locale's pattern has none. */
  readonly period: string;
}

export type DateStyle = 'short' | 'medium' | 'weekday';

export interface Formatters {
  readonly locale: Locale;
  /** Integer paise → "₹1,00,000" / "₹72,000.50". Throws on non-integer or unsafe values. */
  money(paise: number): string;
  /** Plain number with Indian grouping and Latin digits ("1,204"). */
  number(value: number): string;
  /** Wall-clock "HH:mm" (24h) → localized 12-hour parts. Throws on malformed input. */
  time(hhmm: string): TimeParts;
  /** Date → "26 Sep" (short), "26 Sep 2026" (medium), "Thu, 8 Oct" (weekday), in IST. */
  date(value: Date, style?: DateStyle): string;
  /** "2 hours ago", "yesterday" up to 6 days; older → short date (medium if another year). */
  relative(value: Date, now: Date): string;
  /** Hijri date via Intl Umm al-Qura (stub; offset and after-Maghrib rollover come from packages/domain/hijri). */
  hijri(value: Date): string;
  /** "A, B and C". */
  list(items: readonly string[]): string;
}

const cache = new Map<Locale, Formatters>();

const isLatin = (text: string) => /^[\p{Script=Latin}\s.]*$/u.test(text);
const normalizeSpaces = (text: string) => text.trim().replace(/\s+/gu, ' ');

/**
 * Returns the (memoized) formatters for a locale.
 *
 * @param locale - UI locale.
 * @returns formatter functions; pure apart from the internal cache.
 */
export function formatters(locale: Locale): Formatters {
  const cached = cache.get(locale);
  if (cached) return cached;

  const intlLocale = INTL_LOCALE[locale];
  const money = new Intl.NumberFormat(MONEY_LOCALE, {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    numberingSystem: 'latn',
  });
  const moneyWithPaise = new Intl.NumberFormat(MONEY_LOCALE, {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    numberingSystem: 'latn',
  });
  const number = new Intl.NumberFormat(MONEY_LOCALE, { numberingSystem: 'latn', maximumFractionDigits: 0 });
  const time = new Intl.DateTimeFormat(intlLocale, {
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
    timeZone: 'UTC',
    numberingSystem: 'latn',
  });
  const dates: Record<DateStyle, Intl.DateTimeFormat> = {
    short: new Intl.DateTimeFormat(intlLocale, {
      day: 'numeric',
      month: 'short',
      timeZone: DISPLAY_TIME_ZONE,
      numberingSystem: 'latn',
    }),
    medium: new Intl.DateTimeFormat(intlLocale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: DISPLAY_TIME_ZONE,
      numberingSystem: 'latn',
    }),
    weekday: new Intl.DateTimeFormat(intlLocale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: DISPLAY_TIME_ZONE,
      numberingSystem: 'latn',
    }),
  };
  const year = new Intl.DateTimeFormat('en-IN', { year: 'numeric', timeZone: DISPLAY_TIME_ZONE });
  const relative = new Intl.RelativeTimeFormat(`${intlLocale}-u-nu-latn`, { numeric: 'auto' });
  const hijri = new Intl.DateTimeFormat(`${intlLocale}-u-ca-islamic-umalqura-nu-latn`, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: DISPLAY_TIME_ZONE,
  });
  const list = new Intl.ListFormat(intlLocale, { style: 'long', type: 'conjunction' });

  const result: Formatters = {
    locale,
    money(paise) {
      if (!Number.isSafeInteger(paise)) throw new RangeError('money(): paise must be a safe integer');
      return paise % 100 === 0 ? money.format(paise / 100) : moneyWithPaise.format(paise / 100);
    },
    number: (value) => number.format(value),
    time(hhmm) {
      const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
      if (!match) throw new RangeError('time(): expected "HH:mm"');
      const parts = time.formatToParts(new Date(Date.UTC(2000, 0, 1, Number(match[1]), Number(match[2]))));
      const periodPart = parts.find((part) => part.type === 'dayPeriod')?.value ?? '';
      const period = isLatin(periodPart) ? periodPart.toUpperCase() : periodPart;
      const clock = normalizeSpaces(
        parts
          .filter((part) => part.type !== 'dayPeriod')
          .map((part) => part.value)
          .join(''),
      );
      const text = normalizeSpaces(parts.map((part) => (part.type === 'dayPeriod' ? period : part.value)).join(''));
      return { text, time: clock, period };
    },
    date: (value, style = 'short') => dates[style].format(value),
    relative(value, now) {
      const seconds = Math.round((value.getTime() - now.getTime()) / 1000);
      const abs = Math.abs(seconds);
      if (abs < 60) return relative.format(0, 'second');
      if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
      if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
      const days = Math.round(seconds / 86_400);
      if (Math.abs(days) <= RELATIVE_MAX_DAYS) return relative.format(days, 'day');
      return year.format(value) === year.format(now) ? dates.short.format(value) : dates.medium.format(value);
    },
    hijri: (value) => hijri.format(value),
    list: (items) => list.format(items),
  };
  cache.set(locale, result);
  return result;
}
