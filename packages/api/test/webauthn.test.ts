// The SimpleWebAuthn wrapper (04 §3, PHASE_01 T1.8) without a database: option shapes, the base64url challenge round
// trip, excluded credentials, log reasons that never quote received values, the user-handle rule, and that the
// sign-counter rule is NOT applied here (the data layer applies it after the signature — see webauthn.ts).
import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  authenticationOptions,
  CEREMONY_TIMEOUT_MS,
  registrationOptions,
  type RelyingParty,
  verifyAssertion,
  verifyRegistration,
} from '../src/auth/webauthn.ts';
import { SoftAuthenticator } from './soft-authenticator.ts';

const RP: RelyingParty = { id: 'admin.test', name: 'Test Admin App', origin: 'https://admin.test' };
const authenticator = new SoftAuthenticator(RP.origin);
const challenge = () => randomBytes(32).toString('base64url');

async function registered() {
  const userHandle = new Uint8Array(randomBytes(32));
  const c = challenge();
  const options = await registrationOptions(RP, { challenge: c, userHandle, displayName: 'Test Admin', exclude: [] });
  const { credential, response } = authenticator.create(options);
  const result = await verifyRegistration(RP, response, c);
  if (!result.ok) throw new Error(result.reason);
  return { credential, stored: { ...result.value, userHandle } };
}

describe('registration', () => {
  it('options: our challenge unchanged, user handle as given, excluded credentials with transports, 5-min timeout', async () => {
    const c = challenge();
    const userHandle = new Uint8Array(randomBytes(32));
    const existing = new Uint8Array(randomBytes(16));
    const options = await registrationOptions(RP, {
      challenge: c,
      userHandle,
      displayName: 'Test Admin',
      exclude: [{ id: existing, transports: ['internal'] }],
    });
    expect(options.challenge).toBe(c);
    expect(options.user).toEqual({
      id: Buffer.from(userHandle).toString('base64url'),
      name: 'Test Admin',
      displayName: 'Test Admin',
    });
    expect(options.excludeCredentials).toEqual([
      { id: Buffer.from(existing).toString('base64url'), type: 'public-key', transports: ['internal'] },
    ]);
    expect(options.timeout).toBe(CEREMONY_TIMEOUT_MS);
    expect(CEREMONY_TIMEOUT_MS).toBe(300_000);
  });

  it('a verified registration returns the key material, counter, transports and backup state', async () => {
    const { credential, stored } = await registered();
    expect(Buffer.from(stored.id).equals(Buffer.from(credential.id))).toBe(true);
    expect(stored.publicKey.length).toBeGreaterThan(60);
    expect(stored).toMatchObject({ counter: 0, backedUp: true, deviceType: 'multiDevice' });
    expect(stored.transports).toEqual(['internal', 'hybrid']);
    expect(stored.aaguid).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('failure reasons keep the message but never a quoted value (challenges, origins)', async () => {
    const c = challenge();
    const options = await registrationOptions(RP, {
      challenge: c,
      userHandle: new Uint8Array(32),
      displayName: 'Test Admin',
      exclude: [],
    });
    const wrong = challenge();
    const result = await verifyRegistration(RP, authenticator.create(options, { challenge: wrong }).response, c);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/challenge/);
    expect(result.reason).toContain('"…"');
    expect(result.reason).not.toContain(wrong);
    expect(result.reason).not.toContain(c);
  });

  it('garbage that passes the schema is a reason, not an exception', async () => {
    const result = await verifyRegistration(
      RP,
      { id: 'AAAA', rawId: 'AAAA', type: 'public-key', response: { clientDataJSON: 'e30', attestationObject: 'AAAA' } },
      challenge(),
    );
    expect(result.ok).toBe(false);
  });
});

describe('authentication', () => {
  it('options: discoverable (no allowCredentials), UV required, our RP ID and challenge', async () => {
    const c = challenge();
    expect(await authenticationOptions(RP, c)).toEqual({
      challenge: c,
      timeout: CEREMONY_TIMEOUT_MS,
      rpId: 'admin.test',
      userVerification: 'required',
    });
  });

  it('returns the received counter without judging it — even a lower one (the data layer decides, after this)', async () => {
    const { credential, stored } = await registered();
    for (const counter of [7, 1, 0]) {
      credential.counter = counter;
      const c = challenge();
      const result = await verifyAssertion(
        RP,
        authenticator.get(await authenticationOptions(RP, c), credential),
        c,
        stored,
      );
      expect(result).toEqual({ ok: true, value: { newCounter: counter } });
    }
  });

  it('the user handle must be present and the credential owner’s', async () => {
    const { credential, stored } = await registered();
    for (const userHandle of [null, new Uint8Array(randomBytes(32))]) {
      const c = challenge();
      const result = await verifyAssertion(
        RP,
        authenticator.get(await authenticationOptions(RP, c), credential, { userHandle }),
        c,
        stored,
      );
      expect(result).toEqual({ ok: false, reason: 'user handle missing or not the credential owner' });
    }
  });

  it('another credential’s key does not verify (signature), reported as a reason', async () => {
    const a = await registered();
    const b = await registered();
    const c = challenge();
    const result = await verifyAssertion(
      RP,
      authenticator.get(await authenticationOptions(RP, c), { ...b.credential, userHandle: a.stored.userHandle }),
      c,
      { ...a.stored, id: b.stored.id },
    );
    expect(result.ok).toBe(false);
  });
});
