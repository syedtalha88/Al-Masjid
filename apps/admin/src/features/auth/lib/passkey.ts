// Passkey ceremonies in the browser (04 §3, 03 §4) with the platform WebAuthn API only — no client library: options
// arrive as JSON from api-admin (base64url binary fields), go to `navigator.credentials`, and the credential goes back
// as JSON. The server verifies everything (challenge, origin, rpId, user verification); this module only converts
// formats and maps browser errors to what the admin should be told.
import type { CreationOptionsJSON, RequestOptionsJSON } from '@mc/shared/contracts';

/** base64url (no padding) → bytes. */
export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** bytes → base64url (no padding). */
export function toBase64url(data: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type DescriptorJSON = NonNullable<RequestOptionsJSON['allowCredentials']>[number];

/** Drops `undefined` members (the browser types are exact-optional). */
const defined = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T; // same keys, no undefined

const descriptor = (d: DescriptorJSON): PublicKeyCredentialDescriptor => ({
  id: fromBase64url(d.id),
  type: d.type,
  ...(d.transports ? { transports: d.transports as AuthenticatorTransport[] } : {}), // server-provided names
});

/** Converts creation options JSON to the browser's binary form. */
export function toCreationOptions(json: CreationOptionsJSON): PublicKeyCredentialCreationOptions {
  return {
    rp: { name: json.rp.name, ...(json.rp.id ? { id: json.rp.id } : {}) },
    user: { ...json.user, id: fromBase64url(json.user.id) },
    challenge: fromBase64url(json.challenge),
    pubKeyCredParams: [...json.pubKeyCredParams],
    ...(json.timeout === undefined ? {} : { timeout: json.timeout }),
    ...(json.excludeCredentials ? { excludeCredentials: json.excludeCredentials.map(descriptor) } : {}),
    ...(json.authenticatorSelection
      ? { authenticatorSelection: defined(json.authenticatorSelection) as AuthenticatorSelectionCriteria }
      : {}),
    ...(json.attestation ? { attestation: json.attestation } : {}),
  };
}

/** Converts request options JSON to the browser's binary form. */
export function toRequestOptions(json: RequestOptionsJSON): PublicKeyCredentialRequestOptions {
  return {
    challenge: fromBase64url(json.challenge),
    ...(json.timeout === undefined ? {} : { timeout: json.timeout }),
    ...(json.rpId ? { rpId: json.rpId } : {}),
    ...(json.allowCredentials ? { allowCredentials: json.allowCredentials.map(descriptor) } : {}),
    ...(json.userVerification ? { userVerification: json.userVerification } : {}),
  };
}

/** The registration credential as JSON (`RegistrationResponseJSON`). */
export function registrationToJSON(credential: PublicKeyCredential): Record<string, unknown> {
  const response = credential.response as AuthenticatorAttestationResponse; // create() returns an attestation
  return {
    id: credential.id,
    rawId: toBase64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toBase64url(response.clientDataJSON),
      attestationObject: toBase64url(response.attestationObject),
      transports: typeof response.getTransports === 'function' ? response.getTransports() : [],
    },
  };
}

/** The assertion as JSON (`AuthenticationResponseJSON`). */
export function authenticationToJSON(credential: PublicKeyCredential): Record<string, unknown> {
  const response = credential.response as AuthenticatorAssertionResponse; // get() returns an assertion
  return {
    id: credential.id,
    rawId: toBase64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toBase64url(response.clientDataJSON),
      authenticatorData: toBase64url(response.authenticatorData),
      signature: toBase64url(response.signature),
      ...(response.userHandle ? { userHandle: toBase64url(response.userHandle) } : {}),
    },
  };
}

/** What went wrong, in the terms the screens explain (07 B1). */
export type PasskeyFailure = 'cancelled' | 'no-screen-lock' | 'unsupported' | 'already-registered' | 'failed';

export class PasskeyError extends Error {
  override readonly name = 'PasskeyError';
  readonly failure: PasskeyFailure;
  constructor(failure: PasskeyFailure, options?: ErrorOptions) {
    super(`passkey ${failure}`, options);
    this.failure = failure;
  }
}

/** Maps a browser WebAuthn error (DOMException names from the spec) to a failure kind. */
export function classifyPasskeyError(error: unknown): PasskeyFailure {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'AbortError') return 'cancelled';
  if (name === 'InvalidStateError') return 'already-registered';
  if (name === 'NotSupportedError' || name === 'SecurityError') return 'unsupported';
  return 'failed';
}

/** True when this device can create a passkey protected by its screen lock (user verification). */
export async function hasScreenLockPasskey(): Promise<boolean> {
  if (typeof PublicKeyCredential === 'undefined') return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Runs `navigator.credentials.create` for registration options from the server.
 *
 * @throws PasskeyError with the failure kind.
 */
export async function createPasskey(options: CreationOptionsJSON): Promise<Record<string, unknown>> {
  if (typeof PublicKeyCredential === 'undefined') throw new PasskeyError('unsupported');
  try {
    const credential = await navigator.credentials.create({ publicKey: toCreationOptions(options) });
    if (!(credential instanceof PublicKeyCredential)) throw new PasskeyError('failed');
    return registrationToJSON(credential);
  } catch (error) {
    if (error instanceof PasskeyError) throw error;
    throw new PasskeyError(classifyPasskeyError(error), { cause: error });
  }
}

/**
 * Runs `navigator.credentials.get` for login / step-up options from the server.
 *
 * @throws PasskeyError with the failure kind.
 */
export async function getPasskey(options: RequestOptionsJSON): Promise<Record<string, unknown>> {
  if (typeof PublicKeyCredential === 'undefined') throw new PasskeyError('unsupported');
  try {
    const credential = await navigator.credentials.get({ publicKey: toRequestOptions(options) });
    if (!(credential instanceof PublicKeyCredential)) throw new PasskeyError('failed');
    return authenticationToJSON(credential);
  } catch (error) {
    if (error instanceof PasskeyError) throw error;
    throw new PasskeyError(classifyPasskeyError(error), { cause: error });
  }
}
