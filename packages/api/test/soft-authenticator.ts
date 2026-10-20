// A software passkey authenticator for API tests (PHASE_01 T1.8): real P-256 keys, a CBOR `none` attestation and
// signed assertions exactly as a browser + platform authenticator would send them — with switches for everything a
// test needs to break (origin, RP ID, user verification, counter, user handle, signature). The browser e2e uses
// Chromium's virtual authenticator instead.
import { createHash, createPublicKey, generateKeyPairSync, type KeyObject, randomBytes, sign } from 'node:crypto';

import type {
  AuthenticationResponse,
  CreationOptionsJSON,
  RegistrationResponse,
  RequestOptionsJSON,
} from '@mc/shared/contracts';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08; // backup eligible (synced passkey)
const FLAG_BS = 0x10; // backed up
const FLAG_AT = 0x40; // attested credential data present

const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest();
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

export interface SoftCredential {
  readonly id: Uint8Array;
  readonly userHandle: Uint8Array;
  readonly privateKey: KeyObject;
  readonly rpId: string;
  /** The counter the next assertion reports (tests set it; synced passkeys always send 0). */
  counter: number;
}

export interface CeremonyOverrides {
  /** User verification flag (default true). */
  readonly uv?: boolean;
  readonly origin?: string;
  /** The RP ID whose hash goes into authenticatorData. */
  readonly rpId?: string;
  readonly challenge?: string;
}

export class SoftAuthenticator {
  readonly origin: string;
  constructor(origin: string) {
    this.origin = origin;
  }

  #flags(uv: boolean, extra = 0): number {
    return FLAG_UP | (uv ? FLAG_UV : 0) | FLAG_BE | FLAG_BS | extra;
  }

  #clientData(type: string, challenge: string, origin: string): string {
    return JSON.stringify({ type, challenge, origin, crossOrigin: false });
  }

  /** `navigator.credentials.create` for the server's options. */
  create(
    options: CreationOptionsJSON,
    o: CeremonyOverrides & {
      /** Registers this existing credential again (same id and key) instead of a new one. */
      readonly same?: SoftCredential;
      /** A real authenticator model id (16 bytes) instead of the all-zero AAGUID. */
      readonly aaguid?: Uint8Array;
    } = {},
  ): { credential: SoftCredential; response: RegistrationResponse } {
    const rpId = o.rpId ?? options.rp.id ?? new URL(this.origin).hostname;
    const { privateKey, publicKey } = o.same
      ? { privateKey: o.same.privateKey, publicKey: createPublicKey(o.same.privateKey) }
      : generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    if (!jwk.x || !jwk.y) throw new Error('no EC coordinates');
    const cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))],
        [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))],
      ]),
    );
    const id = o.same?.id ?? new Uint8Array(randomBytes(32));
    const credLen = Buffer.alloc(2);
    credLen.writeUInt16BE(id.length);
    const authData = Buffer.concat([
      sha256(rpId),
      Buffer.from([this.#flags(o.uv ?? true, FLAG_AT)]),
      u32(0),
      o.aaguid ?? Buffer.alloc(16), // AAGUID: zeros with attestation "none"
      credLen,
      id,
      cose,
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Uint8Array | Map<string, never>>([
        ['fmt', 'none'],
        ['attStmt', new Map<string, never>()],
        ['authData', new Uint8Array(authData)],
      ]),
    );
    const clientDataJSON = this.#clientData(
      'webauthn.create',
      o.challenge ?? options.challenge,
      o.origin ?? this.origin,
    );
    return {
      credential: {
        id,
        userHandle: new Uint8Array(Buffer.from(options.user.id, 'base64url')),
        privateKey,
        rpId,
        counter: 0,
      },
      response: {
        id: b64(id),
        rawId: b64(id),
        type: 'public-key',
        response: {
          clientDataJSON: Buffer.from(clientDataJSON).toString('base64url'),
          attestationObject: b64(attestationObject),
          transports: ['internal', 'hybrid'],
        },
      },
    };
  }

  /** `navigator.credentials.get` with `credential` for the server's options. */
  get(
    options: RequestOptionsJSON,
    credential: SoftCredential,
    o: CeremonyOverrides & {
      /** `null` sends no userHandle at all. */
      readonly userHandle?: Uint8Array | null;
      /** Flips a bit of the signature. */
      readonly badSignature?: boolean;
    } = {},
  ): AuthenticationResponse {
    const authData = Buffer.concat([
      sha256(o.rpId ?? credential.rpId),
      Buffer.from([this.#flags(o.uv ?? true)]),
      u32(credential.counter),
    ]);
    const clientDataJSON = Buffer.from(
      this.#clientData('webauthn.get', o.challenge ?? options.challenge, o.origin ?? this.origin),
    );
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), credential.privateKey);
    if (o.badSignature) signature[signature.length - 1] = (signature.at(-1) ?? 0) ^ 0x01;
    const userHandle = o.userHandle === undefined ? credential.userHandle : o.userHandle;
    return {
      id: b64(credential.id),
      rawId: b64(credential.id),
      type: 'public-key',
      response: {
        clientDataJSON: clientDataJSON.toString('base64url'),
        authenticatorData: authData.toString('base64url'),
        signature: signature.toString('base64url'),
        ...(userHandle ? { userHandle: b64(userHandle) } : {}),
      },
    };
  }
}
