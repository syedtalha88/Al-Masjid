import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  FOLLOW_CODE_ALPHABET,
  followCodeFromBytes,
  followCodeFromScan,
  formatFollowCode,
  isFollowCode,
  normalizeFollowCode,
} from '../src/follow-code.ts';

// 00 §4.1: 8 characters Crockford Base32, shown as ABCD-EFGH; input is case-insensitive, ignores dashes/spaces,
// maps O→0 and I/L→1. 04 §6: a scanned QR is accepted only as https://<app origin>/m/<code> or a bare code.

const APP = 'https://app.example.com';
const bytes5 = fc.uint8Array({ minLength: 5, maxLength: 5 });

describe('followCodeFromBytes', () => {
  it('maps 40 random bits to 8 Crockford characters', () => {
    expect(FOLLOW_CODE_ALPHABET).toHaveLength(32);
    expect(followCodeFromBytes(new Uint8Array(5))).toBe('00000000');
    expect(followCodeFromBytes(new Uint8Array(5).fill(255))).toBe('ZZZZZZZZ');
    // 0x0000000001 → last character "1"; 0x8000000000 → first 5 bits 10000 = 16 = "G".
    expect(followCodeFromBytes(Uint8Array.of(0, 0, 0, 0, 1))).toBe('00000001');
    expect(followCodeFromBytes(Uint8Array.of(0x80, 0, 0, 0, 0))).toBe('G0000000');
  });

  it('refuses anything but exactly 5 bytes', () => {
    expect(() => followCodeFromBytes(new Uint8Array(4))).toThrow(RangeError);
    expect(() => followCodeFromBytes(new Uint8Array(6))).toThrow(RangeError);
  });

  it('always yields a canonical code', () => {
    fc.assert(fc.property(bytes5, (bytes) => isFollowCode(followCodeFromBytes(bytes))));
  });
});

describe('isFollowCode', () => {
  it('accepts only the canonical form', () => {
    expect(isFollowCode('ABCD2345')).toBe(true);
    expect(isFollowCode('abcd2345')).toBe(false);
    expect(isFollowCode('ABCD-2345')).toBe(false);
    expect(isFollowCode('ABCDO345')).toBe(false); // O is not in the alphabet
    expect(isFollowCode('ABCDU345')).toBe(false); // nor U
    expect(isFollowCode('ABCD234')).toBe(false);
    expect(isFollowCode(12345678)).toBe(false);
  });
});

describe('normalizeFollowCode', () => {
  it('is case-insensitive and ignores dashes and spaces', () => {
    expect(normalizeFollowCode('abcd-2345')).toBe('ABCD2345');
    expect(normalizeFollowCode(' ab cd 23 45 ')).toBe('ABCD2345');
    expect(normalizeFollowCode('ABCD‐2345')).toBe('ABCD2345'); // typographic hyphen from a pasted message
    expect(normalizeFollowCode('ABCD 2345')).toBe('ABCD2345');
  });

  it('maps the ambiguous letters O→0 and I/L→1', () => {
    expect(normalizeFollowCode('OOOO-IIII')).toBe('00001111');
    expect(normalizeFollowCode('olol-lili')).toBe('01011111');
  });

  it('rejects wrong lengths, unknown characters and absurd input', () => {
    expect(normalizeFollowCode('ABCD234')).toBeNull();
    expect(normalizeFollowCode('ABCD23456')).toBeNull();
    expect(normalizeFollowCode('ABCDU345')).toBeNull();
    expect(normalizeFollowCode('ABCD#345')).toBeNull();
    expect(normalizeFollowCode('')).toBeNull();
    expect(normalizeFollowCode('A'.repeat(100))).toBeNull();
  });

  it('normalize ∘ generate = identity (property)', () => {
    fc.assert(
      fc.property(bytes5, (bytes) => {
        const code = followCodeFromBytes(bytes);
        return normalizeFollowCode(code) === code && normalizeFollowCode(formatFollowCode(code).toLowerCase()) === code;
      }),
    );
  });
});

describe('formatFollowCode', () => {
  it('splits into two groups of four', () => {
    expect(formatFollowCode('ABCD2345')).toBe('ABCD-2345');
  });

  it('refuses a non-canonical code', () => {
    expect(() => formatFollowCode('abcd2345')).toThrow(RangeError);
  });
});

describe('followCodeFromScan', () => {
  it('accepts the app link with or without dash, slash, query or fragment', () => {
    expect(followCodeFromScan(`${APP}/m/ABCD2345`, APP)).toBe('ABCD2345');
    expect(followCodeFromScan(`${APP}/m/abcd-2345/`, APP)).toBe('ABCD2345');
    expect(followCodeFromScan(`  ${APP}/m/ABCD2345?source=poster#x  `, APP)).toBe('ABCD2345');
    expect(followCodeFromScan(`${APP}/m/ABCD%2D2345`, APP)).toBe('ABCD2345');
  });

  it('accepts a bare code', () => {
    expect(followCodeFromScan('ABCD-2345', APP)).toBe('ABCD2345');
    expect(followCodeFromScan('abcd2345', APP)).toBe('ABCD2345');
  });

  it('rejects every other QR payload', () => {
    for (const text of [
      'http://app.example.com/m/ABCD2345', // not https
      'https://app.example.com.evil.test/m/ABCD2345', // look-alike host
      'https://evil.test/m/ABCD2345',
      'https://user@app.example.com/m/ABCD2345', // credentials
      'https://app.example.com:8443/m/ABCD2345', // other origin (port)
      'https://app.example.com/p/ABCD2345', // other path
      'https://app.example.com/m/ABCD2345/extra',
      'https://app.example.com/m/',
      'https://app.example.com/m/ABCD%ZZ2345', // malformed escape
      'https://app.example.com/x/m/ABCD2345',
      'upi://pay?pa=test@okexample',
      'WIFI:S:masjid;T:WPA;P:secret;;',
      'ABCD 2345 6789',
      'not a url',
      'ABCD/2345', // has a slash but is no URL
      '',
    ]) {
      expect(followCodeFromScan(text, APP), text).toBeNull();
    }
  });

  it('refuses everything when the app origin itself is unusable', () => {
    expect(followCodeFromScan(`${APP}/m/ABCD2345`, 'not an origin')).toBeNull();
    expect(followCodeFromScan('ABCD2345', 'not an origin')).toBe('ABCD2345');
  });
});
