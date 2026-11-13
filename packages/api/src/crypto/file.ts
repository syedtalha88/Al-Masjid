// Private files at rest (04 §5 "At rest", DECISIONS #40, PHASE_08 T8.5): a legal order's document is encrypted in
// api-admin with AES-256-GCM before it leaves the process, with a key derived from the field-encryption key ring
// (HKDF-SHA256, info `mc-file-v1` — never the field key itself, DECISIONS #180 L7; current key id recorded for
// rotation), a random 96-bit IV per file, and the file's purpose + owner bound as associated data — a
// stored blob copied to another order never decrypts there. Storage (Cloudinary `raw` + `authenticated`) only ever
// holds ciphertext.
//
// Envelope: "MCF2" | key-id length (1 byte) | key id | IV (12) | ciphertext | tag (16).
// The plaintext starts with one byte naming the sniffed type, so the download is served with the right type without
// trusting anything the uploader claimed.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

import { FieldCryptoError, type FieldKeyRing } from './field.ts';

/** `MCF2`: the file key is derived (#180 L7). `MCF1` (the field key itself) was never deployed and is not read. */
const MAGIC = Buffer.from('MCF2', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;

export const PRIVATE_FILE_TYPES = {
  pdf: { code: 1, mime: 'application/pdf', ext: 'pdf' },
  jpeg: { code: 2, mime: 'image/jpeg', ext: 'jpg' },
  png: { code: 3, mime: 'image/png', ext: 'png' },
} as const;
export type PrivateFileType = keyof typeof PRIVATE_FILE_TYPES;

/**
 * The file's type by its first bytes (never the client's claim).
 *
 * @returns `undefined` for anything that is not a PDF, JPEG or PNG.
 */
export function sniffPrivateFile(bytes: Buffer): PrivateFileType | undefined {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return undefined;
}

const aad = (context: string) => Buffer.from(`mc-file:${context}`, 'utf8');

/** The file key for a ring key: HKDF-SHA256 (no salt — the ring key is uniformly random), its own `info`. */
const fileKey = (ringKey: Buffer): Buffer =>
  Buffer.from(hkdfSync('sha256', ringKey, Buffer.alloc(0), 'mc-file-v1', 32));

/**
 * Encrypts a file with the ring's current key.
 *
 * @param context - what the file belongs to, e.g. `legal_orders.document:<orderId>` (associated data).
 * @returns the envelope (plaintext length + 1 + 33 + key id bytes).
 */
export function encryptFile(ring: FieldKeyRing, bytes: Buffer, type: PrivateFileType, context: string): Buffer {
  const key = ring.keys.get(ring.currentId);
  if (!key) throw new FieldCryptoError('current key missing from the ring');
  const keyId = Buffer.from(ring.currentId, 'ascii');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', fileKey(key), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(context));
  const body = Buffer.concat([
    cipher.update(Buffer.from([PRIVATE_FILE_TYPES[type].code])),
    cipher.update(bytes),
    cipher.final(),
  ]);
  return Buffer.concat([MAGIC, Buffer.from([keyId.length]), keyId, iv, body, cipher.getAuthTag()]);
}

/**
 * Decrypts an envelope written by {@link encryptFile} with the current or an old key.
 *
 * @throws FieldCryptoError — one message for every cause (malformed, unknown key, other context, tampering).
 */
export function decryptFile(
  ring: FieldKeyRing,
  envelope: Buffer,
  context: string,
): { readonly bytes: Buffer; readonly type: PrivateFileType } {
  const fail = () => new FieldCryptoError('cannot decrypt file');
  if (envelope.length < MAGIC.length + 1 + IV_BYTES + TAG_BYTES + 1 || !envelope.subarray(0, 4).equals(MAGIC)) {
    throw fail();
  }
  const idLength = envelope[4] ?? 0;
  const keyId = envelope.subarray(5, 5 + idLength).toString('ascii');
  const key = ring.keys.get(keyId);
  const ivStart = 5 + idLength;
  if (!key || envelope.length < ivStart + IV_BYTES + TAG_BYTES + 1) throw fail();
  const iv = envelope.subarray(ivStart, ivStart + IV_BYTES);
  const body = envelope.subarray(ivStart + IV_BYTES, envelope.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', fileKey(key), iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(context));
    decipher.setAuthTag(envelope.subarray(envelope.length - TAG_BYTES));
    const plain = Buffer.concat([decipher.update(body), decipher.final()]);
    const type = (Object.keys(PRIVATE_FILE_TYPES) as PrivateFileType[]).find(
      (name) => PRIVATE_FILE_TYPES[name].code === plain[0],
    ); // the keys of a const object
    if (!type) throw fail();
    return { bytes: plain.subarray(1), type };
  } catch {
    throw fail();
  }
}
