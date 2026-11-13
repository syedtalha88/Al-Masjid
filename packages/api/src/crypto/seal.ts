// Sealed fields (PHASE_08 T8.4, DECISIONS #173): a grievance's optional contact is encrypted in api-public — which may
// hold no symmetric field key (04 §8, `@mc/shared/env`) — with an RSA public key, and opened only in api-admin with the
// private key. Each value gets a fresh AES-256-GCM key (associated data: the grievance's reference) wrapped with
// RSA-OAEP-SHA-256. Stored: `s1:<keyId>:<wrapped key>:<iv>:<ciphertext + tag>`, base64url.
import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';

const VERSION = 's1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID = /^[a-z0-9-]{1,32}$/;
const VALUE = /^s1:([a-z0-9-]{1,32}):([A-Za-z0-9_-]{100,1400}):([A-Za-z0-9_-]{16}):([A-Za-z0-9_-]{22,})$/;
const OAEP = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' } as const;

/**
 * The smallest RSA modulus accepted on staging and production (NIST SP 800-57: 3072 bits for use beyond 2030; the
 * owner's keys are 4096 — O53). Local development keys may be 2048 bits (`setup:local`, tests) — DECISIONS #180 L7.
 */
export const SEAL_MIN_BITS = 3072;
/** The floor everywhere, local included. */
export const SEAL_MIN_BITS_LOCAL = 2048;

const bitsOf = (key: KeyObject): number => key.asymmetricKeyDetails?.modulusLength ?? 0;

/** Every failure looks the same to callers (no oracle about which part was wrong). */
export class SealError extends Error {}

/** api-admin's private keys by id (the current one and old ones still opening older values). */
export type SealKeys = ReadonlyMap<string, KeyObject>;

const pemOf = (base64: string): string => Buffer.from(base64, 'base64').toString('utf8');

/**
 * api-admin's opening keys from the env (`GRIEVANCE_SEAL_PRIVATE_KEY` base64 PEM, `GRIEVANCE_SEAL_KEY_ID`, optional
 * `GRIEVANCE_SEAL_OLD_KEYS` = `id:base64pem,…`).
 *
 * @param options.minBits - the smallest RSA modulus accepted ({@link SEAL_MIN_BITS} outside local).
 * @throws SealError for a malformed key or id, or a key smaller than `minBits`.
 */
export function sealKeysFromEnv(
  env: {
    readonly GRIEVANCE_SEAL_PRIVATE_KEY: string;
    readonly GRIEVANCE_SEAL_KEY_ID: string;
    readonly GRIEVANCE_SEAL_OLD_KEYS?: string | undefined;
  },
  options: { readonly minBits?: number } = {},
): SealKeys {
  const minBits = Math.max(options.minBits ?? SEAL_MIN_BITS, SEAL_MIN_BITS_LOCAL);
  const keys = new Map<string, KeyObject>();
  const add = (id: string, base64: string) => {
    if (!KEY_ID.test(id) || keys.has(id)) throw new SealError('malformed seal key id');
    let key: KeyObject;
    try {
      key = createPrivateKey(pemOf(base64));
    } catch {
      throw new SealError('malformed seal key');
    }
    if (key.asymmetricKeyType !== 'rsa') throw new SealError('malformed seal key');
    if (bitsOf(key) < minBits) throw new SealError('seal key too small');
    keys.set(id, key);
  };
  add(env.GRIEVANCE_SEAL_KEY_ID, env.GRIEVANCE_SEAL_PRIVATE_KEY);
  for (const entry of (env.GRIEVANCE_SEAL_OLD_KEYS ?? '').split(',').filter(Boolean)) {
    const [id = '', base64 = '', ...rest] = entry.split(':');
    if (rest.length > 0) throw new SealError('malformed old seal key');
    add(id, base64);
  }
  return keys;
}

const b64u = (bytes: Buffer) => bytes.toString('base64url');

/**
 * Checks api-public's sealing key at boot (RSA, at least `minBits`), so a weak or wrong key never seals anything.
 *
 * @throws SealError for a malformed key, a non-RSA key or one smaller than `minBits`.
 */
export function assertSealPublicKey(publicKeyBase64: string, minBits: number = SEAL_MIN_BITS): void {
  let key: KeyObject;
  try {
    key = createPublicKey(pemOf(publicKeyBase64));
  } catch {
    throw new SealError('malformed seal public key');
  }
  if (key.asymmetricKeyType !== 'rsa') throw new SealError('malformed seal public key');
  if (bitsOf(key) < Math.max(minBits, SEAL_MIN_BITS_LOCAL)) throw new SealError('seal key too small');
}

/**
 * Seals `plaintext` (api-public).
 *
 * @param key.publicKey - base64 of the SPKI PEM public key (`GRIEVANCE_SEAL_PUBLIC_KEY`).
 * @param aad - associated data binding the value to its record (the grievance's reference).
 * @throws SealError for a malformed public key or id.
 */
export function sealField(
  key: { readonly publicKey: string; readonly keyId: string },
  plaintext: string,
  aad: string,
): string {
  if (!KEY_ID.test(key.keyId)) throw new SealError('malformed seal key id');
  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey(pemOf(key.publicKey));
  } catch {
    throw new SealError('malformed seal public key');
  }
  const dataKey = randomBytes(32);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', dataKey, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const wrapped = publicEncrypt({ key: publicKey, ...OAEP }, dataKey);
  dataKey.fill(0);
  return [VERSION, key.keyId, b64u(wrapped), b64u(iv), b64u(body)].join(':');
}

/**
 * Opens a sealed value (api-admin, the ★ "Show contact").
 *
 * @throws SealError for anything wrong — unknown key id, another record's value, tampering, a malformed value.
 */
export function openSealed(keys: SealKeys, value: string, aad: string): string {
  const match = VALUE.exec(value);
  const key = match ? keys.get(match[1] ?? '') : undefined;
  if (!match || !key) throw new SealError('cannot open');
  try {
    const dataKey = privateDecrypt({ key, ...OAEP }, Buffer.from(match[2] ?? '', 'base64url'));
    const body = Buffer.from(match[4] ?? '', 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(match[3] ?? '', 'base64url'), {
      authTagLength: TAG_BYTES, // a shorter tag is refused, never accepted (Semgrep gcm-no-tag-length)
    });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    const text = Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]);
    dataKey.fill(0);
    return text.toString('utf8');
  } catch {
    throw new SealError('cannot open');
  }
}
