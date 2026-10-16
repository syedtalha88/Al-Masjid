// PHASE_01 T1.7: round trip, tamper detection, key rotation, field binding, token helpers — with fast-check properties.
import { randomBytes } from 'node:crypto';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  decryptField,
  encryptField,
  FieldCryptoError,
  hashToken,
  keyRingFromEnv,
  needsReEncryption,
  newToken,
  tokensEqual,
} from '../src/crypto/field.ts';

const key = () => randomBytes(32).toString('base64url');
const ring = keyRingFromEnv({ FIELD_ENCRYPTION_KEY: key(), FIELD_ENCRYPTION_KEY_ID: 'k2026' });
const PHONE = 'admin_users.phone_enc';
/** The database validator's pattern for encrypted fields (packages/db schema ENCRYPTED_PATTERN). */
const STORED = /^v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22,}$/;

describe('encryptField / decryptField', () => {
  it('round-trips any text, including empty and non-Latin, in the stored format', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (text) => {
        const value = encryptField(ring, text, PHONE);
        expect(value).toMatch(STORED);
        expect(decryptField(ring, value, PHONE)).toBe(text);
      }),
      { numRuns: 300 },
    );
    expect(decryptField(ring, encryptField(ring, '+91 98480 22338', PHONE), PHONE)).toBe('+91 98480 22338');
    expect(decryptField(ring, encryptField(ring, 'مسجد · మసీదు · मस्जिद', PHONE), PHONE)).toBe('مسجد · మసీదు · मस्जिद');
  });

  it('uses a fresh IV every time (same text → different ciphertexts)', () => {
    const values = new Set(Array.from({ length: 200 }, () => encryptField(ring, 'same', PHONE)));
    expect(values.size).toBe(200);
  });

  it('detects any single-character change in the iv or ciphertext/tag', () => {
    const value = encryptField(ring, '+91 98480 22338', PHONE);
    const prefix = value.lastIndexOf(':', value.lastIndexOf(':') - 1) + 1; // start of the iv
    fc.assert(
      fc.property(fc.integer({ min: prefix, max: value.length - 1 }), (index) => {
        const original = value.charAt(index);
        if (original === ':') return;
        const replacement = original === 'A' ? 'B' : 'A';
        const tampered = value.slice(0, index) + replacement + value.slice(index + 1);
        expect(() => decryptField(ring, tampered, PHONE)).toThrow(FieldCryptoError);
      }),
      { numRuns: 200 },
    );
  });

  it('is bound to its field: a value copied into another field never decrypts there', () => {
    const value = encryptField(ring, '+91 98480 22338', PHONE);
    expect(() => decryptField(ring, value, 'grievances.contact_enc')).toThrow(FieldCryptoError);
  });

  it('every failure looks the same (no oracle): malformed, unknown key, truncated', () => {
    const value = encryptField(ring, 'x', PHONE);
    const messages = [
      'nonsense',
      'v1:k2026:short:short',
      value.replace(':k2026:', ':unknown:'),
      value.slice(0, -4),
      `v2${value.slice(2)}`,
    ].map((bad) => {
      try {
        decryptField(ring, bad, PHONE);
        return 'decrypted!';
      } catch (error) {
        return error instanceof FieldCryptoError ? error.message : 'other';
      }
    });
    expect(new Set(messages)).toEqual(new Set(['cannot decrypt field']));
  });
});

describe('key rotation', () => {
  it('old values decrypt after rotation, are flagged for re-encryption, and new values use the new key', () => {
    const oldKey = key();
    const before = keyRingFromEnv({ FIELD_ENCRYPTION_KEY: oldKey, FIELD_ENCRYPTION_KEY_ID: 'k2025' });
    const stored = encryptField(before, '+91 90000 00001', PHONE);
    const after = keyRingFromEnv({
      FIELD_ENCRYPTION_KEY: key(),
      FIELD_ENCRYPTION_KEY_ID: 'k2026',
      FIELD_ENCRYPTION_OLD_KEYS: `k2025:${oldKey}`,
    });
    expect(decryptField(after, stored, PHONE)).toBe('+91 90000 00001');
    expect(needsReEncryption(after, stored)).toBe(true);
    const fresh = encryptField(after, '+91 90000 00001', PHONE);
    expect(fresh.startsWith('v1:k2026:')).toBe(true);
    expect(needsReEncryption(after, fresh)).toBe(false);
    // once the old key is dropped from the ring, old values no longer decrypt
    const later = keyRingFromEnv({ FIELD_ENCRYPTION_KEY: key(), FIELD_ENCRYPTION_KEY_ID: 'k2027' });
    expect(() => decryptField(later, stored, PHONE)).toThrow(FieldCryptoError);
  });

  it('refuses malformed key material', () => {
    expect(() => keyRingFromEnv({ FIELD_ENCRYPTION_KEY: 'short', FIELD_ENCRYPTION_KEY_ID: 'k' })).toThrow(
      FieldCryptoError,
    );
    expect(() => keyRingFromEnv({ FIELD_ENCRYPTION_KEY: key(), FIELD_ENCRYPTION_KEY_ID: 'Bad Id' })).toThrow(
      FieldCryptoError,
    );
    expect(() =>
      keyRingFromEnv({
        FIELD_ENCRYPTION_KEY: key(),
        FIELD_ENCRYPTION_KEY_ID: 'k1',
        FIELD_ENCRYPTION_OLD_KEYS: `k1:${key()}`,
      }),
    ).toThrow(FieldCryptoError); // old id reusing the current id
    expect(() =>
      keyRingFromEnv({
        FIELD_ENCRYPTION_KEY: key(),
        FIELD_ENCRYPTION_KEY_ID: 'k1',
        FIELD_ENCRYPTION_OLD_KEYS: 'k0:abc',
      }),
    ).toThrow(FieldCryptoError);
  });
});

describe('tokens', () => {
  const pepper = randomBytes(32);

  it('new tokens are 32 random bytes in base64url', () => {
    const token = newToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(newToken()).not.toBe(token);
  });

  it('hashToken = SHA-256(token || pepper): deterministic, pepper-dependent, 32 bytes', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 64 }), (token) => {
        const a = hashToken(token, pepper);
        expect(a).toHaveLength(32);
        expect(tokensEqual(a, hashToken(token, pepper))).toBe(true);
        expect(tokensEqual(a, hashToken(token, randomBytes(32)))).toBe(false);
      }),
    );
  });

  it('tokensEqual: equal, different, different lengths', () => {
    const a = randomBytes(32);
    expect(tokensEqual(a, Buffer.from(a))).toBe(true);
    expect(tokensEqual(a, randomBytes(32))).toBe(false);
    expect(tokensEqual(a, a.subarray(0, 31))).toBe(false);
  });
});
