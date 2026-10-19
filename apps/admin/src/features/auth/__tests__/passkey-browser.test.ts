// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPasskey, getPasskey, hasScreenLockPasskey, PasskeyError, toBase64url } from '../lib/passkey.ts';

// PHASE_01 T1.8: the browser side of the ceremonies with a stubbed WebAuthn API (jsdom has none) — the credential is
// turned into the JSON the server verifies, and every failure becomes a PasskeyError the screens can explain.

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

class FakePublicKeyCredential {
  static isUserVerifyingPlatformAuthenticatorAvailable = vi.fn(() => Promise.resolve(true));
  readonly id = 'cred-1';
  readonly rawId = bytes(1, 2, 3);
  readonly type = 'public-key';
  readonly authenticatorAttachment: string | null = 'platform';
  readonly response: Record<string, unknown>;
  constructor(response: Record<string, unknown>) {
    this.response = response;
  }
  getClientExtensionResults() {
    return {};
  }
}

const credentials = { create: vi.fn(), get: vi.fn() };

function installWebAuthn() {
  vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential);
  Object.defineProperty(navigator, 'credentials', { value: credentials, configurable: true });
}

const CREATION = {
  rp: { id: 'localhost', name: 'Test RP' },
  user: { id: 'dQ', name: 't', displayName: 'T' },
  challenge: 'Yw',
  pubKeyCredParams: [{ type: 'public-key' as const, alg: -7 }],
};
const REQUEST = { challenge: 'Yw', userVerification: 'required' as const };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('passkeys in the browser', () => {
  it('no WebAuthn at all: unsupported, and no screen-lock passkey', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined);
    expect(await hasScreenLockPasskey()).toBe(false);
    await expect(createPasskey(CREATION)).rejects.toMatchObject({ failure: 'unsupported' });
    await expect(getPasskey(REQUEST)).rejects.toMatchObject({ failure: 'unsupported' });
  });

  it('screen-lock check: the platform answer, and false when the check itself throws', async () => {
    installWebAuthn();
    FakePublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable.mockResolvedValueOnce(true);
    expect(await hasScreenLockPasskey()).toBe(true);
    FakePublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable.mockRejectedValueOnce(new Error('x'));
    expect(await hasScreenLockPasskey()).toBe(false);
  });

  it('registration: binary fields become base64url JSON', async () => {
    installWebAuthn();
    credentials.create.mockResolvedValue(
      new FakePublicKeyCredential({
        clientDataJSON: bytes(4),
        attestationObject: bytes(5, 6),
        getTransports: () => ['internal'],
      }),
    );
    const json = await createPasskey(CREATION);
    expect(json).toMatchObject({
      id: 'cred-1',
      rawId: toBase64url(bytes(1, 2, 3)),
      type: 'public-key',
      response: {
        clientDataJSON: toBase64url(bytes(4)),
        attestationObject: toBase64url(bytes(5, 6)),
        transports: ['internal'],
      },
    });
    const publicKey = (credentials.create.mock.calls[0]?.[0] as { publicKey: PublicKeyCredentialCreationOptions })
      .publicKey;
    expect(publicKey.challenge).toBeInstanceOf(Uint8Array);
  });

  it('login: the assertion (with user handle) becomes JSON', async () => {
    installWebAuthn();
    credentials.get.mockResolvedValue(
      new FakePublicKeyCredential({
        clientDataJSON: bytes(4),
        authenticatorData: bytes(7),
        signature: bytes(8),
        userHandle: bytes(9),
      }),
    );
    expect(await getPasskey(REQUEST)).toMatchObject({
      response: { authenticatorData: toBase64url(bytes(7)), signature: toBase64url(bytes(8)), userHandle: 'CQ' },
    });
  });

  it('failures: cancelled, already registered, not a credential', async () => {
    installWebAuthn();
    credentials.create.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    await expect(createPasskey(CREATION)).rejects.toMatchObject({ failure: 'cancelled' });
    credentials.create.mockRejectedValueOnce(new DOMException('dup', 'InvalidStateError'));
    await expect(createPasskey(CREATION)).rejects.toMatchObject({ failure: 'already-registered' });
    credentials.get.mockResolvedValueOnce(null);
    const error: unknown = await getPasskey(REQUEST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PasskeyError);
    expect(error).toMatchObject({ failure: 'failed' });
  });
});
