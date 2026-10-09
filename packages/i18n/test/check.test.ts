import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from '@formatjs/icu-messageformat-parser';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildReviewCsv,
  checkLocales,
  flatten,
  looksUntranslated,
  placeholders,
  type ProblemKind,
  renderedLength,
  reviewedDrafts,
  unreviewedCount,
} from '../tools/check.ts';

// Fixture strings are neutral UI copy — never religious text (CLAUDE.md §2.3).
const EN_COMMON = {
  title: 'Settings',
  greet: 'Hello {name}',
  count: '{count, plural, one {# item} other {# items}}',
  nested: { save: 'Save' },
};
const UR_COMMON = {
  title: 'ترتیبات',
  greet: 'سلام {name}',
  count: '{count, plural, one {# چیز} other {# چیزیں}}',
  nested: { save: 'محفوظ کریں' },
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface FixtureOptions {
  readonly en?: Record<string, unknown> | string;
  readonly ur?: Record<string, unknown> | string | null;
  readonly extraUr?: Record<string, Record<string, unknown>>;
  readonly meta?: Record<string, unknown>;
  /** Write review CSVs matching the drafts (default true). */
  readonly freshReview?: boolean;
}

function fixture({ en = EN_COMMON, ur = UR_COMMON, extraUr = {}, meta, freshReview = true }: FixtureOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mc-i18n-'));
  roots.push(root);
  const write = (path: string, value: unknown) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
  };
  write('locales/en/common.json', en);
  mkdirSync(join(root, 'locales/ur'), { recursive: true });
  if (ur !== null) write('locales/ur/common.json', ur);
  for (const [namespace, value] of Object.entries(extraUr)) write(`locales/ur/${namespace}.json`, value);
  if (meta) write('meta/common.json', meta);
  if (freshReview) write('review/ur.csv', buildReviewCsv(root, 'ur'));
  return root;
}

const kinds = (root: string) => checkLocales(root, ['en', 'ur']).map((problem) => problem.kind);
const ast = (message: string) => parse(message, { requiresOtherClause: true });

describe('checkLocales', () => {
  it('passes a complete, valid fixture', () => {
    expect(checkLocales(fixture(), ['en', 'ur'])).toEqual([]);
  });

  it.each<[string, FixtureOptions, ProblemKind]>([
    ['missing key', { ur: { ...UR_COMMON, nested: {} } }, 'missing-key'],
    ['extra key', { ur: { ...UR_COMMON, stray: 'زائد' } }, 'extra-key'],
    ['missing file', { ur: null }, 'missing-file'],
    ['extra file', { extraUr: { orphan: { a: 'ب' } } }, 'extra-file'],
    ['invalid JSON', { ur: '{"title": ' }, 'invalid-json'],
    ['non-string value', { ur: { ...UR_COMMON, title: 3 } }, 'not-a-string'],
    ['empty string', { ur: { ...UR_COMMON, title: '  ' } }, 'empty'],
    ['broken ICU', { ur: { ...UR_COMMON, greet: 'سلام {name' } }, 'invalid-icu'],
    ['plural without other', { ur: { ...UR_COMMON, count: '{count, plural, one {# چیز}}' } }, 'invalid-icu'],
    ['renamed placeholder', { ur: { ...UR_COMMON, greet: 'سلام {nam}' } }, 'placeholder-mismatch'],
    ['untranslated English', { ur: { ...UR_COMMON, title: 'Open your settings page now' } }, 'untranslated'],
    ['meta for an unknown key', { meta: { nope: { context: 'x' } } }, 'meta-unknown-key'],
    ['too long', { meta: { 'nested.save': { context: 'button', maxLength: 5 } } }, 'too-long'],
  ])('reports %s', (_name, options, kind) => {
    expect(kinds(fixture(options))).toContain(kind);
  });

  it('reports a stale review CSV', () => {
    expect(kinds(fixture({ freshReview: false }))).toEqual(['review-stale']);
  });

  it('accepts the real locale files of this package', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    expect(checkLocales(root)).toEqual([]);
  });
});

describe('review CSV', () => {
  it('keeps reviewed=yes only while the draft is unchanged', () => {
    const root = fixture();
    expect(unreviewedCount(root, 'ur')).toBe(4);
    const approved = buildReviewCsv(root, 'ur').replace(/,no\n/gu, ',yes\n');
    writeFileSync(join(root, 'review/ur.csv'), approved);
    expect(unreviewedCount(root, 'ur')).toBe(0);

    writeFileSync(join(root, 'locales/ur/common.json'), JSON.stringify({ ...UR_COMMON, title: 'نئی ترتیبات' }));
    expect(unreviewedCount(root, 'ur')).toBe(1);
  });

  it('round-trips quoted cells with commas, quotes and newlines', () => {
    const csv = 'namespace,key,en,draft,reviewed\ncommon,a,"x, y","say ""hi""\nthere",yes\ncommon,b,z,w,no\n';
    expect([...reviewedDrafts(csv)]).toEqual([['common:a', 'say "hi"\nthere']]);
  });
});

describe('helpers', () => {
  it('flatten produces dotted keys', () => {
    expect([...flatten({ a: { b: 'x', c: { d: 'y' } }, e: 'z' }).keys()]).toEqual(['a.b', 'a.c.d', 'e']);
  });

  it('placeholders collects arguments inside plural branches and tags', () => {
    expect([...placeholders(ast('{count, plural, other {<b>{name}</b> #}}'))].sort()).toEqual(['count', 'name']);
  });

  it('renderedLength counts grapheme clusters, 4 per argument, longest branch', () => {
    expect(renderedLength(ast('Save'))).toBe(4);
    expect(renderedLength(ast('{n} left'))).toBe(4 + 5);
    expect(renderedLength(ast('{n, plural, one {a} other {abcdef}}'))).toBe(6);
    // Telugu vowel signs / anusvara join their base letter: మి గి లిం ది = 4 clusters (9 code points).
    expect(renderedLength(ast('మిగిలింది'))).toBe(4);
  });

  it('looksUntranslated flags long Latin-only text but allows whitelisted terms', () => {
    expect(looksUntranslated(ast('Open your settings page now'))).toBe(true);
    expect(looksUntranslated(ast('Pay by UPI'))).toBe(false);
    expect(looksUntranslated(ast('UPI QR WhatsApp YouTube ID'))).toBe(false);
    expect(looksUntranslated(ast('UPI سے ادائیگی کریں ابھی'))).toBe(false);
  });
});
