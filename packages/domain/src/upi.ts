// UPI (01 §5.7, 04 R1 / §6, PHASE_05 T5.1): VPA checks as the database enforces them (02 payment_profiles), the
// `upi://pay` deep link behind "Donate Now" and the UPI QR, and the parser for an admin's scan of the masjid's existing
// UPI QR. We never touch money (CLAUDE.md §2.2): no amount is ever put into or read out of a link.

/** Longest VPA the database accepts (02 payment_profiles `vpa ≤100`). */
export const VPA_MAX_LENGTH = 100;

/** Longest payee name / note put into a link (NPCI deep-link practice: UPI apps cut longer values). */
export const UPI_TEXT_MAX = 50;

/** Longest payee name / note taken from a scanned QR (the database's `payee_name ≤100`). */
const SCANNED_TEXT_MAX = 100;

/** A scanned QR's text is refused beyond this (real UPI QR codes are a few hundred characters). */
const SCAN_MAX_LENGTH = 2048;

// Same as the database validator (packages/db/src/schema/platform.ts VPA_PATTERN).
const VPA = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;

// Line breaks and tabs become spaces; other control characters and the bidi overrides / isolates (which could make a
// name read differently from what it is) are dropped. Joiners (ZWJ / ZWNJ) stay: Indic and Arabic scripts need them.
const BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]/g;
const INVISIBLE = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu;

/** Is `value` a VPA the database accepts (pattern and ≤ {@link VPA_MAX_LENGTH} characters)? */
export function isValidVpa(value: unknown): value is string {
  return typeof value === 'string' && value.length <= VPA_MAX_LENGTH && VPA.test(value);
}

/**
 * Trims and lowercases the handle (the part after "@" — bank handles are case-insensitive); the user part keeps its
 * case. Does not validate: check the result with {@link isValidVpa}.
 */
export function normalizeVpa(value: string): string {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf('@');
  return at < 0 ? trimmed : `${trimmed.slice(0, at)}@${trimmed.slice(at + 1).toLowerCase()}`;
}

/**
 * Printable single-line text, as a payee name or note is kept: breaks → spaces, control / bidi characters dropped,
 * spaces collapsed, trimmed (joiners kept). The admin's typed payee name is stored this way, so the link shows exactly
 * what the Super Admin approved.
 */
export function cleanUpiText(value: string): string {
  return value.replace(BREAKS, ' ').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** At most `max` code points, cut only between letters (a conjunct or an emoji is never split). */
function cut(value: string, max: number): string {
  let out = '';
  let count = 0;
  for (const { segment } of graphemes.segment(value)) {
    const size = Array.from(segment).length;
    if (count + size > max) break;
    out += segment;
    count += size;
  }
  return out;
}

/** RFC 3986 component encoding (UTF-8): also escapes the sub-delimiters encodeURIComponent leaves (!'()*). */
function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export interface UpiPayee {
  readonly vpa: string;
  readonly payeeName: string;
  readonly note?: string;
}

/**
 * The deep link for "Donate Now" and the UPI QR: `upi://pay?pa=<vpa>&pn=<name>[&tn=<note>]&cu=INR`. The VPA is
 * normalized (it holds only characters that need no escaping); the payee name and note are cleaned (see `clean`), cut
 * to {@link UPI_TEXT_MAX} characters and percent-encoded as UTF-8 — never transliterated. No amount (`am`) is ever set.
 *
 * @throws RangeError when the VPA is invalid or the payee name is empty after cleaning.
 */
export function buildUpiUri({ vpa, payeeName, note }: UpiPayee): string {
  const pa = normalizeVpa(vpa);
  if (!isValidVpa(pa)) throw new RangeError('buildUpiUri(): invalid VPA');
  const pn = cut(cleanUpiText(payeeName), UPI_TEXT_MAX);
  if (pn === '') throw new RangeError('buildUpiUri(): empty payee name');
  const tn = note === undefined ? '' : cut(cleanUpiText(note), UPI_TEXT_MAX);
  return `upi://pay?pa=${pa}&pn=${encode(pn)}${tn === '' ? '' : `&tn=${encode(tn)}`}&cu=INR`;
}

export interface ScannedUpi {
  /** Normalized and valid. */
  readonly vpa: string;
  /** Cleaned, ≤ 100 characters; `null` when the QR has none. */
  readonly payeeName: string | null;
  /** Cleaned, ≤ 100 characters; `null` when the QR has none. */
  readonly note: string | null;
}

/** Query-component decoding ('+' is a space, as many bank QR generators write it); `null` when malformed. */
function decode(value: string): string | null {
  try {
    return decodeURIComponent(value.replaceAll('+', ' '));
  } catch {
    return null;
  }
}

const PREFIX = 'upi://pay?';

/**
 * Reads a scanned UPI QR (04 §6): only `upi://pay?…` (scheme and host in any case) is accepted; `pa` must occur once
 * and be a valid VPA; `pn` and `tn` are taken (cleaned, ≤ 100 characters); everything else — `am`, `mc`, `tr`, `cu`,
 * `mode` … — is ignored.
 *
 * @returns the payee, or `null` for anything else (another scheme or path, no / several / an invalid `pa`, malformed
 *   percent-encoding, text over 2048 characters). Never throws.
 */
export function parseUpiUri(text: string): ScannedUpi | null {
  const value = text.trim();
  if (value.length > SCAN_MAX_LENGTH || value.slice(0, PREFIX.length).toLowerCase() !== PREFIX) return null;
  const found = new Map<string, string[]>();
  for (const pair of value.slice(PREFIX.length).split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = decode(pair.slice(0, eq));
    const content = decode(pair.slice(eq + 1));
    if (key === null || content === null) return null;
    found.set(key, [...(found.get(key) ?? []), content]);
  }
  const [pa, ...others] = found.get('pa') ?? [];
  if (pa === undefined || others.length > 0) return null;
  const vpa = normalizeVpa(pa);
  if (!isValidVpa(vpa)) return null;
  const text_ = (key: string) => {
    const cleaned = cut(cleanUpiText(found.get(key)?.[0] ?? ''), SCANNED_TEXT_MAX);
    return cleaned === '' ? null : cleaned;
  };
  return { vpa, payeeName: text_('pn'), note: text_('tn') };
}
