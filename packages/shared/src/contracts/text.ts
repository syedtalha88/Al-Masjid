import { z } from 'zod';

// 04 §6 free text (security review M3, 20 Oct 2026): every name, label, address and reason a person types is
// NFC-normalized and trimmed, and characters that can disguise text are refused — control characters (a newline only
// where the field is multiline), the bidi embedding / override / isolate controls (U+202A–202E, U+2066–2069: "Masjid"
// that renders reversed in the Super Admin list, the audit CSV or the phone's passkey manager), and every other
// invisible format character (see UNSAFE). ZWJ / ZWNJ (U+200D / U+200C) stay allowed: Hindi, Telugu and Urdu spelling
// needs them; so do the direction marks LRM / RLM / ALM (U+200E / U+200F / U+061C), which Urdu text uses legitimately.

/**
 * Characters never allowed in free text (newline handled separately; review L-3, 22 Oct 2026) — by Unicode category,
 * so new invisible characters are refused without a list to keep up to date: controls (Cc), format characters (Cf:
 * bidi embeddings / overrides / isolates, zero-width space, word joiner, BOM, tag characters, …), surrogates (Cs),
 * private use (Co) and the line / paragraph separators (Zl, Zp). The Cf characters real text needs stay allowed:
 * ZWNJ / ZWJ (U+200C / U+200D), LRM / RLM (U+200E / U+200F) and the Arabic letter mark ALM (U+061C). Also refused
 * (review L2): unassigned code points (Cn) and characters that render blank although they are letters or marks —
 * Hangul fillers, the combining grapheme joiner, Khmer inherent vowels, the braille blank, Mongolian free variation
 * selectors and variation selectors (except FE0E / FE0F, which pick text or emoji presentation). Not for content bodies: Cf also covers Arabic number
 * signs (U+0600–0605, U+06DD), which Phase 3 texts may need.
 */
const UNSAFE =
  /(?![\n\u200C-\u200F\u061C])[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\u115F\u1160\u2800\u3164\uFFA0]|[\u034F\u17B4\u17B5\u180B-\u180D\u180F\uFE00-\uFE0D\u{E0100}-\u{E01EF}]/u;

const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** True when `text` contains a character {@link safeText} refuses (newlines count only when not `multiline`). */
export function hasUnsafeCharacters(text: string, multiline = false): boolean {
  return UNSAFE.test(text) || (!multiline && text.includes('\n'));
}

/** How much longer than `max` raw input may be before normalization runs at all (review L-4). */
const RAW_LENGTH_FACTOR = 4;

/**
 * A free-text field (04 §6): NFC, trimmed, `min`–`max` characters, no unsafe characters; `multiline` allows newlines
 * (CRLF → LF, at most two in a row). Raw input longer than 4 × `max` is refused before it is normalized (review L-4),
 * and the OpenAPI document shows the real `min` / `max`.
 */
export function safeText(max: number, options: { readonly min?: number; readonly multiline?: boolean } = {}) {
  const { min = 0, multiline = false } = options;
  return z
    .string()
    .max(max * RAW_LENGTH_FACTOR, { abort: true }) // Zod 4 checks do not abort by default (review L1)
    .normalize('NFC')
    .transform((value) => (multiline ? value.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : value))
    .pipe(
      z
        .string()
        .trim()
        .min(min)
        .max(max)
        .refine((value) => !hasUnsafeCharacters(value, multiline), {
          message: 'contains control or invisible formatting characters',
        })
        // A required field needs something readable: not only spaces, punctuation or symbols (review L2).
        .refine((value) => min === 0 || HAS_LETTER_OR_DIGIT.test(value), {
          message: 'needs at least one letter or digit',
        }),
    )
    .meta({ minLength: min, maxLength: max });
}
