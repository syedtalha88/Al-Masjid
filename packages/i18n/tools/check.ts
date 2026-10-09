import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  isPluralElement,
  isSelectElement,
  isTagElement,
  type MessageFormatElement,
  parse,
  TYPE,
} from '@formatjs/icu-messageformat-parser';

import { LOCALES } from '../src/locales.ts';

/**
 * `pnpm i18n:check` rules (09 §3): every key in all locales, no extra keys, valid ICU (with `other`
 * branches), identical placeholder sets, no empty strings, no untranslated English in non-en files
 * (heuristic), max lengths from `meta/<ns>.json`, review CSVs up to date.
 */

export type ProblemKind =
  | 'missing-file'
  | 'extra-file'
  | 'invalid-json'
  | 'missing-key'
  | 'extra-key'
  | 'not-a-string'
  | 'empty'
  | 'invalid-icu'
  | 'placeholder-mismatch'
  | 'untranslated'
  | 'too-long'
  | 'meta-unknown-key'
  | 'review-stale';

export interface Problem {
  readonly kind: ProblemKind;
  readonly locale?: string;
  readonly namespace?: string;
  readonly key?: string;
  readonly message: string;
}

/** Terms that legitimately stay in Latin script in every language (09 §3). */
export const UNTRANSLATED_WHITELIST = ['UPI', 'QR', 'Masjid Connect', 'Turnstile', 'WhatsApp', 'YouTube', 'ID'];

type Flat = Map<string, unknown>;

/** Flattens nested JSON into dotted keys. */
export function flatten(value: unknown, prefix = '', out: Flat = new Map()): Flat {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
  } else {
    out.set(prefix, value);
  }
  return out;
}

/** Names of all ICU arguments (incl. plural/select selectors and nested branches). */
export function placeholders(elements: readonly MessageFormatElement[], out = new Set<string>()): Set<string> {
  for (const element of elements) {
    if (element.type === TYPE.literal || element.type === TYPE.pound) continue;
    if (isTagElement(element)) {
      placeholders(element.children, out);
      continue;
    }
    out.add(element.value);
    if (isPluralElement(element) || isSelectElement(element)) {
      for (const option of Object.values(element.options)) placeholders(option.value, out);
    }
  }
  return out;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** User-perceived characters: Indic vowel signs / viramas / anusvara join their base letter instead of counting alone. */
function graphemeCount(text: string): number {
  let count = 0;
  for (const _segment of graphemes.segment(text)) count += 1;
  return count;
}

/**
 * Longest rendered text length in grapheme clusters: literals counted, each argument as 4 characters, longest
 * branch wins.
 */
export function renderedLength(elements: readonly MessageFormatElement[]): number {
  let length = 0;
  for (const element of elements) {
    if (element.type === TYPE.literal) length += graphemeCount(element.value);
    else if (isTagElement(element)) length += renderedLength(element.children);
    else if (isPluralElement(element) || isSelectElement(element)) {
      length += Math.max(0, ...Object.values(element.options).map((option) => renderedLength(option.value)));
    } else length += 4;
  }
  return length;
}

function literalText(elements: readonly MessageFormatElement[]): string {
  return elements
    .map((element) => {
      if (element.type === TYPE.literal) return element.value;
      if (isTagElement(element)) return literalText(element.children);
      if (isPluralElement(element) || isSelectElement(element)) {
        return Object.values(element.options)
          .map((option) => literalText(option.value))
          .join(' ');
      }
      return ' ';
    })
    .join('');
}

/** Heuristic (09 §3): Latin-only text with more than 3 words, after removing whitelisted terms. */
export function looksUntranslated(elements: readonly MessageFormatElement[]): boolean {
  let text = literalText(elements);
  for (const term of UNTRANSLATED_WHITELIST) text = text.split(term).join(' ');
  const words = text.match(/[\p{L}\p{M}]+/gu) ?? [];
  if (words.length <= 3) return false;
  return words.every((word) => /^[\p{Script=Latin}\p{M}]+$/u.test(word));
}

function readJson(path: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const namespacesIn = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.slice(0, -'.json'.length))
        .sort()
    : [];

export interface Entry {
  readonly namespace: string;
  readonly key: string;
  readonly en: string;
  readonly translated: string;
}

/** All (namespace, key) rows for one non-source locale, in a stable order. */
export function entriesFor(root: string, locale: string): Entry[] {
  const rows: Entry[] = [];
  for (const namespace of namespacesIn(join(root, 'locales', 'en'))) {
    const en = readJson(join(root, 'locales', 'en', `${namespace}.json`));
    const tr = readJson(join(root, 'locales', locale, `${namespace}.json`));
    if (!en.ok) continue;
    const translated = tr.ok ? flatten(tr.value) : new Map<string, unknown>();
    for (const [key, value] of flatten(en.value)) {
      const target = translated.get(key);
      rows.push({
        namespace,
        key,
        en: typeof value === 'string' ? value : '',
        translated: typeof target === 'string' ? target : '',
      });
    }
  }
  return rows;
}

const csvCell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** Parses our review CSV (namespace,key,en,draft,reviewed) into `namespace:key` → reviewed draft text. */
export function reviewedDrafts(csv: string): Map<string, string> {
  const result = new Map<string, string>();
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv.charAt(i);
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  for (const [namespace, key, , draft, reviewed] of rows.slice(1)) {
    if (namespace && key && draft !== undefined && reviewed?.trim().toLowerCase() === 'yes') {
      result.set(`${namespace}:${key}`, draft);
    }
  }
  return result;
}

/**
 * Builds `review/<locale>.csv` content for translators (09 §3). A row stays `reviewed=yes` only while its
 * draft text is unchanged; editing a string sends it back for review.
 */
export function buildReviewCsv(root: string, locale: string): string {
  const path = join(root, 'review', `${locale}.csv`);
  const reviewed = existsSync(path) ? reviewedDrafts(readFileSync(path, 'utf8')) : new Map<string, string>();
  const lines = ['namespace,key,en,draft,reviewed'];
  for (const entry of entriesFor(root, locale)) {
    const isReviewed = reviewed.get(`${entry.namespace}:${entry.key}`) === entry.translated;
    lines.push(
      [entry.namespace, entry.key, entry.en, entry.translated, isReviewed ? 'yes' : 'no'].map(csvCell).join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Counts rows not yet reviewed by a human translator (reported, not a failure — owner decides, 09 §3). */
export function unreviewedCount(root: string, locale: string): number {
  return buildReviewCsv(root, locale)
    .trim()
    .split('\n')
    .slice(1)
    .filter((line) => line.endsWith(',no')).length;
}

/**
 * Runs every rule over `<root>/locales`, `<root>/meta` and `<root>/review`.
 *
 * @param root - the i18n package directory (or a fixture with the same layout).
 * @param locales - locales to check; the first is the source (`en`).
 * @returns all problems found (empty = pass). Never throws on bad input files.
 */
export function checkLocales(root: string, locales: readonly string[] = LOCALES): Problem[] {
  const problems: Problem[] = [];
  const [source = 'en', ...targets] = locales;
  const sourceNamespaces = namespacesIn(join(root, 'locales', source));

  const parsed = new Map<string, MessageFormatElement[]>();
  const parseMessage = (
    locale: string,
    namespace: string,
    key: string,
    value: string,
  ): MessageFormatElement[] | null => {
    try {
      const ast = parse(value, { requiresOtherClause: true, ignoreTag: false });
      parsed.set(`${locale}:${namespace}:${key}`, ast);
      return ast;
    } catch (error) {
      problems.push({
        kind: 'invalid-icu',
        locale,
        namespace,
        key,
        message: `invalid ICU message: ${error instanceof Error ? error.message : String(error)}`,
      });
      return null;
    }
  };

  const sourceKeys = new Map<string, Flat>();
  for (const namespace of sourceNamespaces) {
    const json = readJson(join(root, 'locales', source, `${namespace}.json`));
    if (!json.ok) {
      problems.push({ kind: 'invalid-json', locale: source, namespace, message: json.error });
      continue;
    }
    const flat = flatten(json.value);
    sourceKeys.set(namespace, flat);
    for (const [key, value] of flat) {
      if (typeof value !== 'string')
        problems.push({ kind: 'not-a-string', locale: source, namespace, key, message: 'value must be a string' });
      else if (value.trim() === '')
        problems.push({ kind: 'empty', locale: source, namespace, key, message: 'empty string' });
      else parseMessage(source, namespace, key, value);
    }
  }

  for (const locale of targets) {
    const namespaces = namespacesIn(join(root, 'locales', locale));
    for (const namespace of namespaces.filter((ns) => !sourceNamespaces.includes(ns))) {
      problems.push({ kind: 'extra-file', locale, namespace, message: `${namespace}.json has no ${source} source` });
    }
    for (const namespace of sourceNamespaces) {
      if (!namespaces.includes(namespace)) {
        problems.push({ kind: 'missing-file', locale, namespace, message: `${namespace}.json is missing` });
        continue;
      }
      const json = readJson(join(root, 'locales', locale, `${namespace}.json`));
      if (!json.ok) {
        problems.push({ kind: 'invalid-json', locale, namespace, message: json.error });
        continue;
      }
      const flat = flatten(json.value);
      const sourceFlat = sourceKeys.get(namespace) ?? new Map<string, unknown>();
      for (const key of sourceFlat.keys()) {
        if (!flat.has(key))
          problems.push({ kind: 'missing-key', locale, namespace, key, message: 'missing translation' });
      }
      for (const [key, value] of flat) {
        if (!sourceFlat.has(key)) {
          problems.push({ kind: 'extra-key', locale, namespace, key, message: `key not in ${source}` });
          continue;
        }
        if (typeof value !== 'string') {
          problems.push({ kind: 'not-a-string', locale, namespace, key, message: 'value must be a string' });
          continue;
        }
        if (value.trim() === '') {
          problems.push({ kind: 'empty', locale, namespace, key, message: 'empty string' });
          continue;
        }
        const ast = parseMessage(locale, namespace, key, value);
        const sourceAst = parsed.get(`${source}:${namespace}:${key}`);
        if (!ast || !sourceAst) continue;
        const expected = [...placeholders(sourceAst)].sort();
        const actual = [...placeholders(ast)].sort();
        if (expected.join(',') !== actual.join(',')) {
          problems.push({
            kind: 'placeholder-mismatch',
            locale,
            namespace,
            key,
            message: `placeholders {${actual.join(', ')}} differ from ${source} {${expected.join(', ')}}`,
          });
        }
        if (looksUntranslated(ast)) {
          problems.push({ kind: 'untranslated', locale, namespace, key, message: 'looks like untranslated English' });
        }
      }
    }
  }

  // Translator metadata: known keys + max lengths in every locale.
  for (const namespace of sourceNamespaces) {
    const metaPath = join(root, 'meta', `${namespace}.json`);
    if (!existsSync(metaPath)) continue;
    const meta = readJson(metaPath);
    if (!meta.ok || typeof meta.value !== 'object' || meta.value === null) {
      problems.push({
        kind: 'invalid-json',
        namespace,
        message: `meta/${namespace}.json: ${meta.ok ? 'not an object' : meta.error}`,
      });
      continue;
    }
    for (const [key, info] of Object.entries(meta.value)) {
      if (!sourceKeys.get(namespace)?.has(key)) {
        problems.push({
          kind: 'meta-unknown-key',
          namespace,
          key,
          message: `meta/${namespace}.json describes an unknown key`,
        });
        continue;
      }
      const maxLength = (info as { maxLength?: unknown }).maxLength; // meta JSON shape: { context, maxLength? }
      if (typeof maxLength !== 'number') continue;
      for (const locale of locales) {
        const ast = parsed.get(`${locale}:${namespace}:${key}`);
        if (ast && renderedLength(ast) > maxLength) {
          problems.push({
            kind: 'too-long',
            locale,
            namespace,
            key,
            message: `about ${String(renderedLength(ast))} characters; the UI allows ${String(maxLength)}`,
          });
        }
      }
    }
  }

  // Review CSVs must list every current draft (run `pnpm i18n:review` to refresh).
  for (const locale of targets) {
    const path = join(root, 'review', `${locale}.csv`);
    const current = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== buildReviewCsv(root, locale)) {
      problems.push({
        kind: 'review-stale',
        locale,
        message: `review/${locale}.csv is out of date — run pnpm i18n:review`,
      });
    }
  }

  return problems;
}
