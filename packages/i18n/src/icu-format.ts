// ICU MessageFormat for i18next (09 §2) without shipping the message parser (PROGRESS F14, DECISIONS #92): production
// builds precompile every catalogue string to its AST (`mcIcuPrecompile`, vite-plugin.ts) and alias the FormatJS parser
// to its `no-parser` stub; this module formats the precompiled ASTs. In dev and tests the catalogues are plain strings
// and the full parser is present, so the same module parses them on first use. Same behaviour as i18next-icu 2.5
// (memoized per language/namespace/key — and message text, see createIcuFormat —, `ignoreTag`, a message that fails to
// format is returned as written).
import type { I18nFormatModule } from 'i18next';
import { IntlMessageFormat } from 'intl-messageformat';

/** First character of a precompiled catalogue value: the rest is the message's AST as JSON. */
export const PRECOMPILED_MARK = '\u0001';

type Formatter = { format(values?: Record<string, unknown>): unknown };

/** Languages written right to left (09 §5). */
const RTL_LANGUAGES = new Set(['ur']);
/** Unicode FIRST STRONG ISOLATE / POP DIRECTIONAL ISOLATE (UAX #9). */
const FSI = '\u2068';
const PDI = '\u2069';

/**
 * In a right-to-left language every string argument becomes a first-strong isolate: its direction comes from its own
 * first letter, and it cannot reorder the sentence around it. Without it, an amount after Urdu words reads "12,500₹"
 * and "%25" — the digits turn into Arabic numbers and the ₹ / % signs move to the other side (DECISIONS #160). A Latin
 * name or a time keeps its order; an Urdu name or date is still right to left. Numbers (plurals) are left alone;
 * text that is already isolated is not wrapped again. Invisible on screen.
 */
export function isolateArguments(
  options: Record<string, unknown> | undefined,
  lng: string,
): Record<string, unknown> | undefined {
  if (!options || !RTL_LANGUAGES.has(lng.split('-')[0] ?? lng)) return options;
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(options))
    out[name] =
      typeof value === 'string' && value !== '' && !/^[\u2066-\u2068]/.test(value) ? `${FSI}${value}${PDI}` : value;
  return out;
}

/** An i18next `i18nFormat` module (the interface i18next-icu implements). */
export interface IcuFormatModule extends I18nFormatModule {
  readonly type: 'i18nFormat';
  init(): void;
  parse(res: unknown, options: Record<string, unknown> | undefined, lng: string, ns: string, key: string): unknown;
  addLookupKeys(finalKeys: string[]): string[];
  clearCache(): void;
}

/**
 * Creates the module (one per i18next instance — its cache is per instance). A cached formatter is reused only for the
 * same message text: i18next passes the *requested* language even when it answers from the fallback (English) while
 * that language's namespace is still loading, so a cache keyed by language/namespace/key alone kept the English text
 * on screen after the real message arrived (Phase 08 — a Super Admin screen in English with `<html lang="te">`).
 */
export function createIcuFormat(): IcuFormatModule {
  let cache = new Map<string, { readonly res: string; readonly formatter: Formatter }>();
  const compile = (res: string, lng: string): Formatter =>
    res.startsWith(PRECOMPILED_MARK)
      ? new IntlMessageFormat(JSON.parse(res.slice(1)) as ConstructorParameters<typeof IntlMessageFormat>[0], lng)
      : new IntlMessageFormat(res, lng, undefined, { ignoreTag: true });
  return {
    type: 'i18nFormat',
    init: () => undefined,
    parse(res, options, lng, ns, key) {
      if (typeof res !== 'string') return res;
      const cacheKey = `${lng}\u0000${ns}\u0000${key}`;
      try {
        const cached = cache.get(cacheKey);
        let formatter = cached?.res === res ? cached.formatter : undefined;
        if (!formatter) {
          formatter = compile(res, lng);
          cache.set(cacheKey, { res, formatter });
        }
        return formatter.format(isolateArguments(options, lng));
      } catch {
        return res.startsWith(PRECOMPILED_MARK) ? key : res;
      }
    },
    addLookupKeys: (finalKeys) => finalKeys,
    clearCache() {
      cache = new Map();
    },
  };
}
