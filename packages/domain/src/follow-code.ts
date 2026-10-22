// Follow codes (00 §4.1, 02 §3): 8 characters of Crockford Base32 (40 random bits), shown as "ABCD-EFGH". Typed
// input is case-insensitive, ignores dashes/spaces and maps the ambiguous letters O→0, I/L→1. Scanned QR contents are
// accepted only as `https://<app origin>/m/<code>` or a bare code (04 §6).

/** Crockford Base32 alphabet (no I, L, O, U). */
export const FOLLOW_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Characters in a code. */
export const FOLLOW_CODE_LENGTH = 8;
/** Random bytes a code is made from (8 × 5 bits = 40 bits). */
export const FOLLOW_CODE_RANDOM_BYTES = 5;

const CANONICAL = /^[0-9A-HJKMNP-TV-Z]{8}$/;
// Spaces of any kind and dashes of any kind (a code pasted from a chat message may carry typographic ones).
const SEPARATORS = /[\s\p{Pd}]/gu;
// Longer input is not a code with separators — no need to look at it.
const MAX_INPUT = 32;

/** Is `value` a code in canonical form ("ABCD2345": upper case, no separator)? */
export function isFollowCode(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL.test(value);
}

/**
 * The code for 5 random bytes (big-endian 40-bit number → 8 base-32 digits).
 *
 * @param bytes - exactly {@link FOLLOW_CODE_RANDOM_BYTES} bytes from a CSPRNG (the caller supplies them; this module
 *   does no I/O).
 * @throws RangeError for any other length.
 */
export function followCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== FOLLOW_CODE_RANDOM_BYTES) throw new RangeError('followCodeFromBytes(): expected 5 bytes');
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let code = '';
  for (let index = 0; index < FOLLOW_CODE_LENGTH; index += 1) {
    code = FOLLOW_CODE_ALPHABET.charAt(Number(value & 31n)) + code;
    value >>= 5n;
  }
  return code;
}

/**
 * Turns what a person typed or pasted into a canonical code.
 *
 * @returns the canonical code, or `null` when the input cannot be one (wrong length or a character outside the
 *   alphabet after mapping).
 */
export function normalizeFollowCode(input: string): string | null {
  if (input.length > MAX_INPUT) return null;
  const code = input.replace(SEPARATORS, '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
  return isFollowCode(code) ? code : null;
}

/**
 * Display form "ABCD-2345".
 *
 * @throws RangeError when `code` is not canonical.
 */
export function formatFollowCode(code: string): string {
  if (!isFollowCode(code)) throw new RangeError('formatFollowCode(): not a canonical follow code');
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

const parseOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

/**
 * The follow code inside a scanned QR payload.
 *
 * @param text - the decoded QR text.
 * @param appOrigin - the musalli app's origin (e.g. `https://app.<domain>`); links to any other origin are refused.
 * @returns the canonical code, or `null` for anything that is not a Masjid Connect follow QR (the caller shows
 *   "This QR is not a Masjid Connect code" and does not navigate).
 */
export function followCodeFromScan(text: string, appOrigin: string): string | null {
  const value = text.trim();
  if (!value.includes('/')) {
    return value.replace(SEPARATORS, '').length === FOLLOW_CODE_LENGTH ? normalizeFollowCode(value) : null;
  }
  const origin = parseOrigin(appOrigin);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (origin === null || url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) {
    return null;
  }
  const match = /^\/m\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) return null;
  let segment: string;
  try {
    segment = decodeURIComponent(String(match[1]));
  } catch {
    return null;
  }
  return normalizeFollowCode(segment);
}
