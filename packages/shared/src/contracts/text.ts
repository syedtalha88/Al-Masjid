import { z } from 'zod';

// 04 §6 free text (security review M3, 20 Oct 2026): every name, label, address and reason a person types is
// NFC-normalized and trimmed, and characters that can disguise text are refused — control characters (a newline only
// where the field is multiline), the bidi embedding / override / isolate controls (U+202A–202E, U+2066–2069: "Masjid"
// that renders reversed in the Super Admin list, the audit CSV or the phone's passkey manager), and invisible
// zero-width space / BOM. ZWJ / ZWNJ (U+200D / U+200C) stay allowed: Hindi, Telugu and Urdu spelling needs them; so do
// the plain direction marks LRM / RLM (U+200E / U+200F), which Urdu text uses legitimately.

/** Characters never allowed in free text (newline handled separately). */
// eslint-disable-next-line no-control-regex -- matching control characters is the point of this rule
const UNSAFE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\u200B\uFEFF]/u;

/** True when `text` contains a character {@link safeText} refuses (newlines count only when not `multiline`). */
export function hasUnsafeCharacters(text: string, multiline = false): boolean {
  return UNSAFE.test(text) || (!multiline && text.includes('\n'));
}

/**
 * A free-text field (04 §6): NFC, trimmed, `min`–`max` characters, no unsafe characters; `multiline` allows newlines
 * (CRLF → LF, at most two in a row).
 */
export function safeText(max: number, options: { readonly min?: number; readonly multiline?: boolean } = {}) {
  const { min = 0, multiline = false } = options;
  return z
    .string()
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
        }),
    );
}
