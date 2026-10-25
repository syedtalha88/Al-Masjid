// ICU messages that arrive at runtime — notice templates from the API (02 §2 `notice_templates.body`, 00 §4.3) —
// unlike catalogue strings, which are precompiled at build time (icu-format.ts). This module is the only one that ships
// the FormatJS parser (≈ 10 kB gzip): `mcIcuPrecompile` keeps the real parser for it alone, and apps load it lazily, only
// on screens that show a template body.
import { parse } from '@formatjs/icu-messageformat-parser';
import { IntlMessageFormat } from 'intl-messageformat';

import { INTL_LOCALE, type Locale } from './locales.ts';

const MAX_CACHE = 200;
const cache = new Map<string, IntlMessageFormat | null>();

function compile(message: string, locale: Locale): IntlMessageFormat | null {
  const key = `${locale}\u0000${message}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let formatter: IntlMessageFormat | null;
  try {
    formatter = new IntlMessageFormat(parse(message, { ignoreTag: true }), INTL_LOCALE[locale]);
  } catch {
    formatter = null;
  }
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(key, formatter);
  return formatter;
}

/**
 * Formats an ICU MessageFormat string for `locale`. Tags are plain text (`ignoreTag`) — the result is text, never markup.
 *
 * @param values - argument values, already formatted for display (times, dates, prayer names) or numbers for plurals.
 * @returns the text, or `null` when the message does not parse or an argument is missing (the caller falls back).
 */
export function formatRuntimeMessage(
  message: string,
  locale: Locale,
  values: Readonly<Record<string, string | number>>,
): string | null {
  const formatter = compile(message, locale);
  if (!formatter) return null;
  try {
    const result = formatter.format(values);
    return typeof result === 'string' ? result : null;
  } catch {
    return null;
  }
}
