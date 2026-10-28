// Search text for the Content Library (02 content_library.search_text, PHASE_03 T3.4): the data layer stores the
// normalized text of an entry, and a query is normalized the same way, so "ṣabr" finds "Sabr" and Arabic typed without
// harakat finds the vowelled text. Only marks that are diacritics are removed — Devanagari and Telugu vowel signs are
// combining marks too, but they are letters of the word and stay.

/** Longest `search_text` the validator admits (02 §2). */
export const SEARCH_TEXT_MAX = 20_000;
/** Words of a query used at most; more only narrow an AND search that is already narrow. */
export const SEARCH_TERMS_MAX = 8;
// Longer queries are cut before normalizing (an admin types a word or two, or taps a chip).
const QUERY_MAX = 200;

// Latin combining diacritics (after NFKD) · Arabic harakat, shadda, sukun, hamza/madda marks, superscript alef ·
// Quranic annotation marks · tatweel · invisible characters typed and stored text may differ in (ZWSP/ZWNJ/ZWJ,
// direction marks and controls, word joiner, BOM, soft hyphen).
const STRIP =
  /[\u0300-\u036F\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u0640\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u061C\uFEFF\u00AD]/gu;
// Everything that is not part of a word becomes a word break.
const NON_WORD = /[^\p{L}\p{N}\p{M}]+/gu;

/**
 * Normalizes text for search: NFKD, lower case, diacritics and invisible characters removed, punctuation and runs of
 * spaces collapsed to single spaces, trimmed. Idempotent.
 */
export function normalizeSearch(text: string): string {
  return text.normalize('NFKD').toLowerCase().normalize('NFKD').replace(STRIP, '').replace(NON_WORD, ' ').trim();
}

/**
 * The words of a search query, normalized, unique, in typed order, at most {@link SEARCH_TERMS_MAX}. Terms never
 * contain quotes or backslashes, so a caller may wrap each in quotes (MongoDB `$text` AND search).
 *
 * @returns `[]` when the query has no word at all.
 */
export function searchTerms(query: string): string[] {
  const words = normalizeSearch(query.slice(0, QUERY_MAX)).split(' ');
  return [...new Set(words.filter((word) => word.length > 0))].slice(0, SEARCH_TERMS_MAX);
}

type LocaleTexts = Readonly<Partial<Record<'en' | 'hi' | 'ur' | 'te', string>>>;

/** The fields of a library entry that are searched. */
export interface SearchableEntry {
  readonly arabic: string;
  readonly transliteration: LocaleTexts;
  readonly translation: LocaleTexts;
  readonly reference: string;
  readonly tags: readonly string[];
}

/**
 * `search_text` of a library entry: reference, tags, English translation, Arabic, the other translations and the
 * transliterations — normalized. When longer than {@link SEARCH_TEXT_MAX} it is cut at the last whole word, so the
 * short identifying fields at the front always survive.
 */
export function librarySearchText(entry: SearchableEntry): string {
  const parts = [
    entry.reference,
    ...entry.tags,
    entry.translation.en,
    entry.arabic,
    entry.translation.hi,
    entry.translation.ur,
    entry.translation.te,
    entry.transliteration.en,
    entry.transliteration.hi,
    entry.transliteration.ur,
    entry.transliteration.te,
  ];
  const text = normalizeSearch(parts.filter((part) => part !== undefined).join(' '));
  if (text.length <= SEARCH_TEXT_MAX) return text;
  const cut = text.lastIndexOf(' ', SEARCH_TEXT_MAX);
  return text.slice(0, cut > 0 ? cut : SEARCH_TEXT_MAX);
}
