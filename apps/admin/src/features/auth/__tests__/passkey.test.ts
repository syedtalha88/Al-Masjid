import { describe, expect, it } from 'vitest';

import {
  classifyPasskeyError,
  fromBase64url,
  toBase64url,
  toCreationOptions,
  toRequestOptions,
} from '../lib/passkey.ts';

// PHASE_01 T1.8 client side: base64url conversions and the error mapping the login/invite screens rely on.
describe('passkey helpers', () => {
  it('base64url round-trips any bytes, without padding', () => {
    for (const length of [0, 1, 2, 3, 31, 32, 33, 64]) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 37 + 11) % 256);
      const text = toBase64url(bytes);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(Array.from(fromBase64url(text))).toEqual(Array.from(bytes));
    }
    expect(toBase64url(new Uint8Array([251, 255]))).toBe('-_8');
  });

  it('converts server option JSON to binary WebAuthn options', () => {
    const creation = toCreationOptions({
      rp: { id: 'admin.example', name: 'Masjid Connect' },
      user: { id: 'AQID', name: 'a', displayName: 'A' },
      challenge: 'BAUG',
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      excludeCredentials: [{ id: 'BwgJ', type: 'public-key', transports: ['internal'] }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      attestation: 'none',
    });
    expect(Array.from(new Uint8Array(creation.user.id as ArrayBuffer))).toEqual([1, 2, 3]);
    expect(Array.from(new Uint8Array(creation.challenge as ArrayBuffer))).toEqual([4, 5, 6]);
    expect(creation.excludeCredentials?.[0]?.transports).toEqual(['internal']);
    const request = toRequestOptions({ challenge: 'AA', userVerification: 'required', allowCredentials: [] });
    expect(request.userVerification).toBe('required');
    expect(request.allowCredentials).toEqual([]);
  });

  it('maps browser errors to what the admin is told', () => {
    expect(classifyPasskeyError(new DOMException('x', 'NotAllowedError'))).toBe('cancelled');
    expect(classifyPasskeyError(new DOMException('x', 'AbortError'))).toBe('cancelled');
    expect(classifyPasskeyError(new DOMException('x', 'InvalidStateError'))).toBe('already-registered');
    expect(classifyPasskeyError(new DOMException('x', 'NotSupportedError'))).toBe('unsupported');
    expect(classifyPasskeyError(new DOMException('x', 'SecurityError'))).toBe('unsupported');
    expect(classifyPasskeyError(new Error('boom'))).toBe('failed');
    expect(classifyPasskeyError('nope')).toBe('failed');
  });
});
