// Passkey ceremonies on the server (04 §3) with @simplewebauthn/server 14.0.3 — the only module that imports it, so
// the 04 §3 settings live in one place: ES256/RS256 only, discoverable credentials, user verification REQUIRED (the
// `uv` flag is checked, not just requested), no attestation, the exact admin origin and RP ID. Every verification
// failure becomes `null` with a reason for the log; callers answer all of them the same way.
import type {
  AuthenticationResponse,
  CreationOptionsJSON,
  RegistrationResponse,
  RequestOptionsJSON,
} from '@mc/shared/contracts';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

import { CHALLENGE_TTL_SEC } from './challenges.ts';

/** COSE algorithms offered and accepted (04 §3): ES256 (-7), RS256 (-257). */
export const PASSKEY_ALGORITHMS: readonly number[] = [-7, -257];
/** How long the browser waits for the screen lock — as long as the challenge lives. */
export const CEREMONY_TIMEOUT_MS = CHALLENGE_TTL_SEC * 1000;

/** The relying party: `RP_ID` (= admin host), the passkey's display name and `ADMIN_ORIGIN` (exact match). */
export interface RelyingParty {
  readonly id: string;
  readonly name: string;
  readonly origin: string;
}

/** A credential's stored key material, as the verifier needs it. */
export interface StoredPasskey {
  readonly id: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly transports: readonly string[];
  /** The owner's WebAuthn user handle. */
  readonly userHandle: Uint8Array;
}

/** A newly verified registration. */
export interface VerifiedRegistration {
  readonly id: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly counter: number;
  readonly transports: readonly string[];
  /** Authenticator model id as text (all zeros with `attestation: 'none'`). */
  readonly aaguid: string;
  readonly backedUp: boolean;
  readonly deviceType: string;
}

export type Verification<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
/** WebAuthn L3 transport hints; anything else a client sends is dropped, not stored (review L5). */
const KNOWN_TRANSPORTS = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);
const knownTransports = (list: readonly string[]) => list.filter((t) => KNOWN_TRANSPORTS.has(t));
/** The challenge is stored as base64url text; the library is given the bytes so it does not re-encode the text. */
const challengeBytes = (challenge: string) => new Uint8Array(Buffer.from(challenge, 'base64url'));

/**
 * The verifiers throw plain errors whose messages quote the received values (origin, challenge, …). The reason we log
 * keeps the message's shape but never a quoted value.
 */
function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : 'verification failed';
  return message.replace(/"[^"]*"/g, '"…"').slice(0, 200);
}

/**
 * Creation options for `navigator.credentials.create` (03 §4 `/auth/register/options`).
 *
 * @param input.challenge - base64url, from the challenge store.
 * @param input.userHandle - the admin's 32-byte WebAuthn user handle (02 §2), never their id.
 * @param input.exclude - the admin's existing credentials (the same authenticator cannot register twice).
 */
export async function registrationOptions(
  rp: RelyingParty,
  input: {
    challenge: string;
    userHandle: Uint8Array;
    displayName: string;
    exclude: readonly { readonly id: Uint8Array; readonly transports: readonly string[] }[];
  },
): Promise<CreationOptionsJSON> {
  const options = await generateRegistrationOptions({
    rpName: rp.name,
    rpID: rp.id,
    userID: new Uint8Array(input.userHandle),
    // Shown in the phone's passkey list: the admin's own display name, nothing else about them.
    userName: input.displayName,
    userDisplayName: input.displayName,
    challenge: challengeBytes(input.challenge),
    timeout: CEREMONY_TIMEOUT_MS,
    attestationType: 'none',
    excludeCredentials: input.exclude.map((c) => ({ id: b64(c.id), transports: [...c.transports] })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    supportedAlgorithmIDs: [...PASSKEY_ALGORITHMS],
  });
  return {
    rp: options.rp,
    user: options.user,
    challenge: options.challenge,
    pubKeyCredParams: options.pubKeyCredParams.map((p) => ({ type: 'public-key' as const, alg: p.alg })),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.excludeCredentials
      ? {
          excludeCredentials: options.excludeCredentials.map((d) => ({
            id: d.id,
            type: 'public-key' as const,
            ...(d.transports ? { transports: [...d.transports] } : {}),
          })),
        }
      : {}),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required', requireResidentKey: true },
    attestation: 'none',
  };
}

/**
 * Verifies a registration against the stored challenge, the exact origin and RP ID, with user verification required.
 *
 * @returns the credential to store, or a reason (never thrown).
 */
export async function verifyRegistration(
  rp: RelyingParty,
  response: RegistrationResponse,
  expectedChallenge: string,
): Promise<Verification<VerifiedRegistration>> {
  try {
    const result = await verifyRegistrationResponse({
      response: {
        id: response.id,
        rawId: response.rawId,
        type: response.type,
        clientExtensionResults: {},
        response: {
          clientDataJSON: response.response.clientDataJSON,
          attestationObject: response.response.attestationObject,
          ...(response.response.transports ? { transports: response.response.transports } : {}),
        },
      },
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      expectedType: 'webauthn.create',
      requireUserPresence: true,
      requireUserVerification: true,
      supportedAlgorithmIDs: [...PASSKEY_ALGORITHMS],
    });
    if (!result.verified) return { ok: false, reason: 'not verified' };
    const info = result.registrationInfo;
    return {
      ok: true,
      value: {
        id: new Uint8Array(Buffer.from(info.credential.id, 'base64url')),
        publicKey: new Uint8Array(info.credential.publicKey),
        counter: info.credential.counter,
        transports: knownTransports(info.credential.transports ?? response.response.transports ?? []),
        aaguid: info.aaguid,
        backedUp: info.credentialBackedUp,
        deviceType: info.credentialDeviceType,
      },
    };
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  }
}

/** Request options for `navigator.credentials.get` — discoverable (no `allowCredentials`), UV required. */
export async function authenticationOptions(rp: RelyingParty, challenge: string): Promise<RequestOptionsJSON> {
  const options = await generateAuthenticationOptions({
    rpID: rp.id,
    challenge: challengeBytes(challenge),
    timeout: CEREMONY_TIMEOUT_MS,
    userVerification: 'required',
    allowCredentials: [],
  });
  return {
    challenge: options.challenge,
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.rpId ? { rpId: options.rpId } : {}),
    userVerification: 'required',
  };
}

/**
 * Verifies an assertion with the stored credential: challenge, exact origin and RP ID, signature, user verification,
 * and — for discoverable credentials — that the returned user handle is the credential owner's (WebAuthn §7.2 step 6).
 * The sign-counter rule (04 §3) is applied by the data layer (`completeAssertion`) AFTER this verification: the
 * library compares counters before it checks the signature, so a forged assertion with a low counter would otherwise
 * look like a cloned authenticator — and revoking on it would let anyone who knows a credential id lock its owner out.
 * The library is therefore given counter 0 (its check off) and returns the received counter.
 *
 * @returns the authenticator's new counter, or a reason (never thrown).
 */
export async function verifyAssertion(
  rp: RelyingParty,
  response: AuthenticationResponse,
  expectedChallenge: string,
  credential: StoredPasskey,
): Promise<Verification<{ readonly newCounter: number }>> {
  const userHandle = response.response.userHandle;
  if (userHandle === undefined || Buffer.from(userHandle, 'base64url').compare(Buffer.from(credential.userHandle))) {
    return { ok: false, reason: 'user handle missing or not the credential owner' };
  }
  try {
    const result = await verifyAuthenticationResponse({
      response: {
        id: response.id,
        rawId: response.rawId,
        type: response.type,
        clientExtensionResults: {},
        response: {
          clientDataJSON: response.response.clientDataJSON,
          authenticatorData: response.response.authenticatorData,
          signature: response.response.signature,
          userHandle,
        },
      },
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      expectedType: 'webauthn.get',
      credential: {
        id: b64(credential.id),
        publicKey: new Uint8Array(credential.publicKey),
        counter: 0, // see above: the 04 §3 rule runs after the signature is verified
        transports: [...credential.transports],
      },
      requireUserVerification: true,
    });
    if (!result.verified) return { ok: false, reason: 'not verified' };
    return { ok: true, value: { newCounter: result.authenticationInfo.newCounter } };
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  }
}
