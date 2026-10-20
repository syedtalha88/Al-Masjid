import { Long, UUID } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { clientOptions } from '../src/client.ts';
import {
  adminScope,
  deviceScope,
  hookScope,
  isScope,
  publicScope,
  scopeMasjidIds,
  superScope,
  systemScope,
} from '../src/scope.ts';
import { fromInt64, idText, newId, parseAaguid, parseId, toInt64, ValueError } from '../src/values.ts';

describe('scopes (01 §5.1)', () => {
  it('constructors make frozen, branded scopes; look-alike objects are not scopes', () => {
    for (const scope of [
      publicScope(),
      deviceScope(new UUID()),
      superScope(new UUID()),
      hookScope('x'),
      systemScope(),
    ]) {
      expect(isScope(scope)).toBe(true);
      expect(Object.isFrozen(scope)).toBe(true);
    }
    expect(isScope({ kind: 'system' })).toBe(false);
    expect(isScope(Object.freeze({ kind: 'super', adminId: new UUID() }))).toBe(false);
    expect(isScope(null)).toBe(false);
  });

  it('admin scope: memberships deduplicated and frozen; masjid ids exposed only for admins', () => {
    const a = new UUID();
    const scope = adminScope({
      adminId: new UUID(),
      masjids: [
        { id: a, role: 'owner' },
        { id: new UUID(a.toHexString()), role: 'editor' },
      ],
    });
    expect(scope.masjids).toHaveLength(1);
    expect(Object.isFrozen(scope.masjids)).toBe(true);
    expect(Object.isFrozen(scope.masjids[0])).toBe(true);
    expect(scopeMasjidIds(scope).map((id) => id.toHexString())).toEqual([a.toHexString()]);
    expect(scopeMasjidIds(publicScope())).toEqual([]);
  });

  it('super scope carries step-up only when given', () => {
    const at = new Date();
    expect(superScope(new UUID(), at).stepUpAt).toBe(at);
    expect('stepUpAt' in superScope(new UUID())).toBe(false);
  });
});

describe('client options (01 §5.1)', () => {
  it('pool sizes per process, majority concerns, TLS outside local', () => {
    expect(clientOptions({ process: 'api-public', local: false })).toMatchObject({
      appName: 'api-public',
      maxPoolSize: 20,
      minPoolSize: 2,
      maxIdleTimeMS: 60_000,
      serverSelectionTimeoutMS: 5_000,
      retryWrites: true,
      retryReads: true,
      w: 'majority',
      readConcernLevel: 'majority',
      tls: true,
    });
    expect(clientOptions({ process: 'worker', local: false }).maxPoolSize).toBe(30);
    expect(clientOptions({ process: 'migrate', local: true })).not.toHaveProperty('tls');
  });
});

describe('values (02 §0)', () => {
  it('toInt64 accepts safe integers in range only', () => {
    expect(toInt64(150_000)).toEqual(Long.fromNumber(150_000));
    expect(() => toInt64(1.5)).toThrow(ValueError);
    expect(() => toInt64(-1)).toThrow(ValueError);
    expect(() => toInt64(1_000_000_000_001)).toThrow(ValueError);
    expect(() => toInt64(Number.MAX_SAFE_INTEGER + 2)).toThrow(ValueError);
    expect(toInt64(-5, -10, 10)).toEqual(Long.fromNumber(-5));
  });

  it('fromInt64 reads longs and promoted numbers; refuses unsafe values', () => {
    expect(fromInt64(Long.fromNumber(42))).toBe(42);
    expect(fromInt64(42)).toBe(42);
    expect(() => fromInt64(Long.fromString('9223372036854775807'))).toThrow(ValueError);
  });

  it('ids: new v4 UUIDs, strict parsing of API text, canonical output', () => {
    const id = newId();
    expect(parseId(idText(id))?.toHexString()).toBe(id.toHexString());
    expect(parseId(idText(id).toUpperCase())?.toHexString()).toBe(id.toHexString());
    expect(parseId('not-a-uuid')).toBeUndefined();
    expect(parseId('00000000-0000-1000-8000-000000000000')).toBeUndefined(); // v1, not v4
    expect(parseId('{"$ne":null}')).toBeUndefined();
  });

  it('AAGUIDs: any UUID version; the all-zero AAGUID of attestation "none" is not stored', () => {
    expect(parseAaguid('EA9B8D66-4D01-1D21-3CE4-B6B48CB575D4')?.toHexString(true)).toBe(
      'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4',
    );
    expect(parseAaguid('00000000-0000-0000-0000-000000000000')).toBeUndefined();
    expect(parseAaguid('not-a-uuid')).toBeUndefined();
    expect(parseAaguid('ea9b8d664d011d213ce4b6b48cb575d4')).toBeUndefined(); // no dashes
  });
});
