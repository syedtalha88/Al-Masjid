// PHASE_08 T8.4 (DECISIONS #173) — grievance contacts sealed in api-public with an RSA public key (fresh AES-256-GCM
// key per value, wrapped with RSA-OAEP-SHA-256), opened only in api-admin with the private key: round trip, the
// grievance id as associated data, key rotation by id, and every failure looking the same.
import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { openSealed, SealError, sealField, sealKeysFromEnv } from '../src/crypto/seal.ts';

const pair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
};
const current = pair();
const old = pair();
const b64 = (text: string) => Buffer.from(text).toString('base64');

describe('sealField / openSealed', () => {
  const keys = sealKeysFromEnv({
    GRIEVANCE_SEAL_PRIVATE_KEY: b64(current.privatePem),
    GRIEVANCE_SEAL_KEY_ID: 'g1',
    GRIEVANCE_SEAL_OLD_KEYS: `g0:${b64(old.privatePem)}`,
  });

  it('round trip; the stored text holds no plaintext and differs every time', () => {
    const sealed = sealField({ publicKey: b64(current.publicPem), keyId: 'g1' }, 'test@example.invalid', 'GR-1');
    expect(sealed).toMatch(/^s1:g1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22,}$/);
    expect(sealed).not.toContain('example');
    expect(sealField({ publicKey: b64(current.publicPem), keyId: 'g1' }, 'test@example.invalid', 'GR-1')).not.toBe(
      sealed,
    );
    expect(openSealed(keys, sealed, 'GR-1')).toBe('test@example.invalid');
  });

  it('an old key still opens what it sealed (rotation)', () => {
    const sealed = sealField({ publicKey: b64(old.publicPem), keyId: 'g0' }, '+910000000000', 'GR-2');
    expect(openSealed(keys, sealed, 'GR-2')).toBe('+910000000000');
  });

  it('wrong grievance, unknown key id, tampering → the same SealError', () => {
    const sealed = sealField({ publicKey: b64(current.publicPem), keyId: 'g1' }, 'secret contact', 'GR-3');
    expect(() => openSealed(keys, sealed, 'GR-4')).toThrow(SealError);
    expect(() => openSealed(keys, sealed.replace('s1:g1:', 's1:gx:'), 'GR-3')).toThrow(SealError);
    const parts = sealed.split(':');
    const flipped = [...parts.slice(0, 4), `${parts[4]?.startsWith('A') ? 'B' : 'A'}${parts[4]?.slice(1) ?? ''}`];
    expect(() => openSealed(keys, flipped.join(':'), 'GR-3')).toThrow(SealError);
    expect(() => openSealed(keys, 'v1:g1:abc:def', 'GR-3')).toThrow(SealError);
  });

  it('a malformed key is refused at boot', () => {
    expect(() => sealKeysFromEnv({ GRIEVANCE_SEAL_PRIVATE_KEY: b64('nope'), GRIEVANCE_SEAL_KEY_ID: 'g1' })).toThrow(
      SealError,
    );
    expect(() => sealField({ publicKey: b64('nope'), keyId: 'g1' }, 'x', 'GR-5')).toThrow(SealError);
  });
});
