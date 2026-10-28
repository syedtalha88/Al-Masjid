import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { librarySearchText, normalizeSearch, SEARCH_TEXT_MAX, searchTerms } from '../src/search.ts';

// Religious text: the 10 §5 placeholders only (harakat added to the placeholder word "نص" to test stripping).
const ARABIC = 'نص تجريبي للعرض فقط';
const ARABIC_WITH_HARAKAT = 'نَصٌّ تـجـريبي للعرض فقط';

describe('normalizeSearch', () => {
  it('lowercases, NFKD-folds Latin diacritics and collapses punctuation and spaces', () => {
    expect(normalizeSearch('  Sample   TRANSLITERATION — DEV ONLY ')).toBe('sample transliteration dev only');
    expect(normalizeSearch('Ṣabr, ṢABR; ṣabr!')).toBe('sabr sabr sabr');
    expect(normalizeSearch('DEV-SAMPLE-001')).toBe('dev sample 001');
  });

  it('removes Arabic harakat, shadda and tatweel', () => {
    expect(normalizeSearch(ARABIC_WITH_HARAKAT)).toBe(normalizeSearch(ARABIC));
    expect(normalizeSearch(ARABIC_WITH_HARAKAT)).toBe('نص تجريبي للعرض فقط');
  });

  it('folds the hamza and madda alef forms to the bare alef (NFKD + mark removal)', () => {
    expect(normalizeSearch('أ إ آ ا')).toBe('ا ا ا ا');
  });

  it('keeps Devanagari and Telugu vowel signs (they are letters of the word, not diacritics)', () => {
    expect(normalizeSearch('विकास के लिए नमूना अनुवाद।')).toBe('विकास के लिए नमूना अनुवाद');
    expect(normalizeSearch('అభివృద్ధి కోసం నమూనా అనువాదం.')).toBe('అభివృద్ధి కోసం నమూనా అనువాదం');
  });

  it('drops zero-width joiners and direction marks, which typed and stored text may differ in', () => {
    expect(normalizeSearch('نمونہ\u200Cترجمہ')).toBe(normalizeSearch('نمونہترجمہ'));
    expect(normalizeSearch('\u200Fترجمہ\u061C')).toBe('ترجمہ');
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (text) => {
        const once = normalizeSearch(text);
        expect(normalizeSearch(once)).toBe(once);
      }),
    );
  });
});

describe('searchTerms', () => {
  it('splits normalized input into unique words, at most 8', () => {
    expect(searchTerms('Sample, sample TEXT')).toEqual(['sample', 'text']);
    expect(searchTerms('a b c d e f g h i j')).toHaveLength(8);
    expect(searchTerms('  — ! ')).toEqual([]);
  });

  it('never returns a quote or backslash (terms are wrapped in quotes for $text)', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        for (const term of searchTerms(text)) expect(term).not.toMatch(/["\\]/);
      }),
    );
  });
});

describe('librarySearchText', () => {
  const entry = {
    arabic: ARABIC_WITH_HARAKAT,
    transliteration: { en: 'Sample transliteration — DEV ONLY' },
    translation: {
      en: 'Sample translation text for development. Not a real hadith.',
      hi: 'विकास के लिए नमूना अनुवाद। यह वास्तविक हदीस नहीं है।',
    },
    reference: 'DEV-SAMPLE-001',
    tags: ['shifa', 'Illness'],
  };

  it('joins Arabic, every transliteration and translation, the reference and the tags — normalized', () => {
    const text = librarySearchText(entry);
    for (const word of ['نص', 'transliteration', 'development', 'नमूना', 'dev', 'sample', '001', 'shifa', 'illness'])
      expect(text.split(' ')).toContain(word);
  });

  it('matches what a query normalizes to', () => {
    const words = librarySearchText(entry).split(' ');
    for (const query of ['نَصّ', 'ILLNESS', 'dev-sample-001']) {
      for (const term of searchTerms(query)) expect(words).toContain(term);
    }
  });

  it(`stays within ${String(SEARCH_TEXT_MAX)} characters, ends on a whole word and keeps reference and tags`, () => {
    const long = { ...entry, translation: { en: 'word '.repeat(6000) } };
    const text = librarySearchText(long);
    expect(text.length).toBeLessThanOrEqual(SEARCH_TEXT_MAX);
    expect(text.endsWith(' word')).toBe(true);
    expect(text.split(' ')).toEqual(expect.arrayContaining(['dev', 'sample', '001', 'shifa', 'illness']));
  });

  it('cuts a single over-long word at the limit', () => {
    const text = librarySearchText({
      arabic: '',
      transliteration: {},
      translation: {},
      reference: 'x'.repeat(25_000),
      tags: [],
    });
    expect(text).toBe('x'.repeat(SEARCH_TEXT_MAX));
  });
});
