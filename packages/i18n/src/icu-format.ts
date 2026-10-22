// ICU MessageFormat for i18next (09 §2) without shipping the message parser (PROGRESS F14, DECISIONS #92): production
// builds precompile every catalogue string to its AST (`mcIcuPrecompile`, vite-plugin.ts) and alias the FormatJS parser
// to its `no-parser` stub; this module formats the precompiled ASTs. In dev and tests the catalogues are plain strings
// and the full parser is present, so the same module parses them on first use. Same behaviour as i18next-icu 2.5
// (memoized per language/namespace/key, `ignoreTag`, a message that fails to format is returned as written).
import type { I18nFormatModule } from 'i18next';
import { IntlMessageFormat } from 'intl-messageformat';

/** First character of a precompiled catalogue value: the rest is the message's AST as JSON. */
export const PRECOMPILED_MARK = '\u0001';

type Formatter = { format(values?: Record<string, unknown>): unknown };

/** An i18next `i18nFormat` module (the interface i18next-icu implements). */
export interface IcuFormatModule extends I18nFormatModule {
  readonly type: 'i18nFormat';
  init(): void;
  parse(res: unknown, options: Record<string, unknown> | undefined, lng: string, ns: string, key: string): unknown;
  addLookupKeys(finalKeys: string[]): string[];
  clearCache(): void;
}

/** Creates the module (one per i18next instance — its cache is per instance). */
export function createIcuFormat(): IcuFormatModule {
  let cache = new Map<string, Formatter>();
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
        let formatter = cache.get(cacheKey);
        if (!formatter) {
          formatter = compile(res, lng);
          cache.set(cacheKey, formatter);
        }
        return formatter.format(options);
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
