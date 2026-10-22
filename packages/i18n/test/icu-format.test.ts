import { parse } from '@formatjs/icu-messageformat-parser';
import { describe, expect, it } from 'vitest';

import { createIcuFormat, PRECOMPILED_MARK } from '../src/icu-format.ts';
import { mapCatalogueStrings, mcIcuPrecompile } from '../src/vite-plugin.ts';

// PROGRESS F14 / DECISIONS #92: production catalogues carry precompiled ICU ASTs; the parser never ships.

const PLURAL = '{count, plural, one {# new update} other {# new updates}}';
const precompiled = (message: string) =>
  PRECOMPILED_MARK + JSON.stringify(parse(message, { ignoreTag: true, shouldParseSkeletons: true }));

describe('createIcuFormat', () => {
  it('formats plain strings (dev) and precompiled ASTs (production) identically', () => {
    const format = createIcuFormat();
    expect(format.type).toBe('i18nFormat');
    expect(format.parse(PLURAL, { count: 1 }, 'en', 'common', 'a')).toBe('1 new update');
    expect(format.parse(precompiled(PLURAL), { count: 5 }, 'en', 'common', 'b')).toBe('5 new updates');
    expect(
      format.parse(
        precompiled('{day} {month} {year}'),
        { day: '16', month: 'Rabi’ al-Akhir', year: '1448' },
        'en',
        'common',
        'c',
      ),
    ).toBe('16 Rabi’ al-Akhir 1448');
  });

  it('memoizes per language/namespace/key and can be cleared', () => {
    const format = createIcuFormat();
    expect(format.parse('Hello {name}', { name: 'A' }, 'en', 'common', 'k')).toBe('Hello A');
    // Same key: the cached formatter is reused even when called with a different resource string.
    expect(format.parse('Bye {name}', { name: 'B' }, 'en', 'common', 'k')).toBe('Hello B');
    format.clearCache();
    expect(format.parse('Bye {name}', { name: 'B' }, 'en', 'common', 'k')).toBe('Bye B');
  });

  it('never throws: a broken message comes back as written (or the key for a broken AST)', () => {
    const format = createIcuFormat();
    expect(format.parse('{oops', {}, 'en', 'common', 'x')).toBe('{oops');
    expect(format.parse(`${PRECOMPILED_MARK}not json`, {}, 'en', 'common', 'y')).toBe('y');
    expect(format.parse(42, {}, 'en', 'common', 'z')).toBe(42);
    expect(format.addLookupKeys(['a'])).toEqual(['a']);
    format.init();
  });
});

describe('mcIcuPrecompile', () => {
  it('compiles every string of a catalogue file and leaves other files alone', async () => {
    const plugin = mcIcuPrecompile();
    const transform = plugin.transform as (code: string, id: string) => Promise<{ code: string } | null>;
    const source = JSON.stringify({ a: 'Hi {name}', nested: { b: PLURAL }, list: ['x'] });
    const out = await transform(source, 'C:/repo/packages/i18n/locales/en/common.json');
    const compiled = JSON.parse(out?.code ?? '{}') as { a: string; nested: { b: string }; list: string[] };
    expect(compiled.a.startsWith(PRECOMPILED_MARK)).toBe(true);
    expect(createIcuFormat().parse(compiled.nested.b, { count: 2 }, 'en', 'common', 'b')).toBe('2 new updates');
    expect(await transform(source, '/repo/apps/app/src/data.json')).toBeNull();
    expect(plugin.apply).toBe('build');
  });

  it('maps only string leaves', () => {
    expect(mapCatalogueStrings({ a: 'x', b: 1, c: [true, 'y'], d: null }, (text) => text.toUpperCase())).toEqual({
      a: 'X',
      b: 1,
      c: [true, 'Y'],
      d: null,
    });
  });
});
