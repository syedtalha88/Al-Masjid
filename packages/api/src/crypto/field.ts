// Field encryption and token helpers (04 §5 "At rest", §4 sessions; PHASE_01 T1.7, DECISIONS #66).
//  - encryptField / decryptField: AES-256-GCM, random 96-bit IV per value, key ring (current key id + old keys for
//    rotation), output `v1:<keyId>:<iv>:<ciphertext+tag>` (base64url) — the shape the database validator enforces.
//    Each value is bound to its field (`context`, used as GCM associated data), so a ciphertext copied into another
//    field never decrypts there.
//  - newToken / hashToken / tokensEqual: 32-byte random tokens, SHA-256(token || pepper) at rest, constant-time compare.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const KEY_ID = /^[a-z0-9-]{1,32}$/;
const VALUE = /^v1:([a-z0-9-]{1,32}):([A-Za-z0-9_-]{16}):([A-Za-z0-9_-]{22,})$/;

/** Every failure of decryption looks the same to callers (no oracle about which part was wrong). */
export class FieldCryptoError extends Error {}

export interface FieldKeyRing {
  readonly currentId: string;
  /** Key id → 32-byte key; always contains `currentId`. */
  readonly keys: ReadonlyMap<string, Buffer>;
}

const decodeKey = (text: string): Buffer => {
  const key = Buffer.from(text, 'base64'); // accepts standard and URL-safe alphabets
  if (key.length !== KEY_BYTES) throw new FieldCryptoError('field encryption key must be 32 bytes');
  return key;
};

/**
 * Builds the key ring from the process env (`FIELD_ENCRYPTION_KEY`, `FIELD_ENCRYPTION_KEY_ID`, optional
 * `FIELD_ENCRYPTION_OLD_KEYS` = `id:base64,id:base64` — validated by `@mc/shared/env` at boot).
 *
 * @throws FieldCryptoError for a malformed key, id or old-key entry, or an old key reusing the current id.
 */
export function keyRingFromEnv(env: {
  readonly FIELD_ENCRYPTION_KEY: string;
  readonly FIELD_ENCRYPTION_KEY_ID: string;
  /** The raw `id:base64,…` text, or the `{ id, key }` pairs `@mc/shared/env` parses it into. */
  readonly FIELD_ENCRYPTION_OLD_KEYS?: string | readonly { readonly id: string; readonly key: string }[] | undefined;
}): FieldKeyRing {
  if (!KEY_ID.test(env.FIELD_ENCRYPTION_KEY_ID)) throw new FieldCryptoError('malformed key id');
  const keys = new Map<string, Buffer>([[env.FIELD_ENCRYPTION_KEY_ID, decodeKey(env.FIELD_ENCRYPTION_KEY)]]);
  const old = env.FIELD_ENCRYPTION_OLD_KEYS;
  const entries =
    typeof old === 'string'
      ? old
          .split(',')
          .filter(Boolean)
          .map((entry) => entry.split(':'))
      : (old ?? []).map((entry) => [entry.id, entry.key]);
  for (const [id = '', key = '', ...rest] of entries) {
    if (rest.length > 0 || !KEY_ID.test(id) || keys.has(id)) throw new FieldCryptoError('malformed old key entry');
    keys.set(id, decodeKey(key));
  }
  return { currentId: env.FIELD_ENCRYPTION_KEY_ID, keys };
}

const aad = (context: string) => Buffer.from(`mc-field:${context}`, 'utf8');

/**
 * Encrypts one field value with the current key.
 *
 * @param context - the field it belongs to, e.g. `admin_users.phone_enc` (bound as associated data).
 * @returns `v1:<keyId>:<iv>:<ciphertext+tag>` — at most ~1.4× the UTF-8 length plus 50 characters.
 */
export function encryptField(ring: FieldKeyRing, plaintext: string, context: string): string {
  const key = ring.keys.get(ring.currentId);
  if (!key) throw new FieldCryptoError('current key missing from the ring');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(context));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `${VERSION}:${ring.currentId}:${iv.toString('base64url')}:${body.toString('base64url')}`;
}

/**
 * Decodes base64url only in its canonical form: Node ignores the unused low bits of the last character, so several
 * strings would otherwise decode to the same bytes — exactly one stored form is accepted (found by the tamper
 * property test, 16 Oct 2026).
 */
function canonicalBase64url(text: string): Buffer | undefined {
  const bytes = Buffer.from(text, 'base64url');
  return bytes.toString('base64url') === text ? bytes : undefined;
}

/**
 * Decrypts a value written by {@link encryptField} with the current or any old key.
 *
 * @throws FieldCryptoError — one message for every cause (malformed value, unknown key id, wrong field, tampering).
 */
export function decryptField(ring: FieldKeyRing, value: string, context: string): string {
  const match = VALUE.exec(value);
  const key = match ? ring.keys.get(match[1] ?? '') : undefined;
  if (!match || !key) throw new FieldCryptoError('cannot decrypt field');
  const iv = canonicalBase64url(match[2] ?? '');
  const body = canonicalBase64url(match[3] ?? '');
  if (!iv || !body || iv.length !== IV_BYTES || body.length < TAG_BYTES) {
    throw new FieldCryptoError('cannot decrypt field');
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(context));
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    throw new FieldCryptoError('cannot decrypt field');
  }
}

/** True when a stored value uses an old key (rotation job re-encrypts it with the current one). */
export function needsReEncryption(ring: FieldKeyRing, value: string): boolean {
  const id = VALUE.exec(value)?.[1];
  return id !== undefined && id !== ring.currentId;
}

/** A new 32-byte random token (session, invite), base64url — shown/sent once, stored only as its hash. */
export const newToken = (): string => randomBytes(32).toString('base64url');

/**
 * `SHA-256(token || pepper)` (04 §4) — what the database stores for sessions and invites.
 *
 * @param token - the token text as received (cookie / invite link).
 * @param pepper - `SESSION_PEPPER` bytes (never in the database).
 */
export function hashToken(token: string, pepper: Buffer): Buffer {
  return createHash('sha256').update(Buffer.from(token, 'utf8')).update(pepper).digest();
}

/** Constant-time equality for hashes/tokens of any length (different lengths → false, still constant per length). */
export function tokensEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    timingSafeEqual(a, a); // same work either way
    return false;
  }
  return timingSafeEqual(a, b);
}
