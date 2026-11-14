import { parse } from '@formatjs/icu-messageformat-parser';
import { describe, expect, it } from 'vitest';

import { createIcuFormat, isolateArguments, PRECOMPILED_MARK } from '../src/icu-format.ts';
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

  it('memoizes per language/namespace/key while the message stays the same; can be cleared', () => {
    const format = createIcuFormat();
    expect(format.parse('Hello {name}', { name: 'A' }, 'en', 'common', 'k')).toBe('Hello A');
    expect(format.parse('Hello {name}', { name: 'B' }, 'en', 'common', 'k')).toBe('Hello B');
    format.clearCache();
    expect(format.parse('Hello {name}', { name: 'C' }, 'en', 'common', 'k')).toBe('Hello C');
  });

  it('a fallback message never sticks: once the language’s own message arrives, it is the one shown', () => {
    // i18next passes the requested language (te) even when it answers from the fallback (en) because te's namespace
    // is still loading. The English text was cached under te/super/key and stayed on screen for good (Phase 08 visual
    // baselines: a Super Admin screen in English with <html lang="te">).
    const format = createIcuFormat();
    expect(format.parse(precompiled('Reports'), undefined, 'te', 'super', 'reports.title')).toBe('Reports');
    expect(format.parse(precompiled('రిపోర్టులు'), undefined, 'te', 'super', 'reports.title')).toBe('రిపోర్టులు');
    expect(format.parse('Open {n}', { n: 2 }, 'ur', 'super', 'tab')).toBe('Open 2');
    expect(format.parse('کھلی {n}', { n: 2 }, 'ur', 'super', 'tab')).toBe('کھلی 2');
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
    // The ready-made dua messages are plain text filling a text box (T3.8) — never compiled.
    expect(await transform(source, 'C:/repo/packages/i18n/locales/ur/dua-messages.json')).toBeNull();
    expect(plugin.apply).toBe('build');
  });

  it('replaces the parser with its no-parser stub everywhere except runtime-message.ts', async () => {
    const plugin = mcIcuPrecompile();
    const resolved: string[] = [];
    const context = {
      resolve: (source: string) => {
        resolved.push(source);
        return Promise.resolve({ id: `/resolved/${source}` });
      },
    };
    const resolveId = plugin.resolveId as (
      this: typeof context,
      source: string,
      importer: string | undefined,
      options: object,
    ) => Promise<{ id: string } | null>;
    const parser = '@formatjs/icu-messageformat-parser';
    expect(await resolveId.call(context, parser, '/repo/node_modules/intl-messageformat/lib/core.js', {})).toEqual({
      id: `/resolved/${parser}/no-parser.js`,
    });
    expect(await resolveId.call(context, parser, undefined, {})).toEqual({ id: `/resolved/${parser}/no-parser.js` });
    expect(await resolveId.call(context, parser, 'C:\\repo\\packages\\i18n\\src\\runtime-message.ts', {})).toBeNull();
    expect(await resolveId.call(context, parser, '/repo/packages/i18n/src/runtime-message.ts?v=1', {})).toBeNull();
    expect(await resolveId.call(context, 'intl-messageformat', '/repo/x.ts', {})).toBeNull();
    expect(resolved).toEqual([`${parser}/no-parser.js`, `${parser}/no-parser.js`]);
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

describe('right-to-left arguments (DECISIONS #160)', () => {
  const FSI = '\u2068';
  const PDI = '\u2069';

  it('Urdu: each string argument is a first-strong isolate — "₹12,500" and "25%" keep their order', () => {
    const format = createIcuFormat();
    const message = '{target} میں سے {received}';
    expect(format.parse(message, { target: '₹50,000', received: '₹12,500' }, 'ur', 'admin', 'x')).toBe(
      `${FSI}₹50,000${PDI} میں سے ${FSI}₹12,500${PDI}`,
    );
  });

  it('numbers (plurals), empty and already isolated text stay as they are; left-to-right languages untouched', () => {
    expect(isolateArguments({ count: 3, name: '', time: '\u20668:45 PM\u2069' }, 'ur')).toEqual({
      count: 3,
      name: '',
      time: '\u20668:45 PM\u2069',
    });
    for (const lng of ['en', 'hi', 'te'])
      expect(isolateArguments({ amount: '₹12,500' }, lng)).toEqual({ amount: '₹12,500' });
    expect(isolateArguments(undefined, 'ur')).toBeUndefined();
  });
});
