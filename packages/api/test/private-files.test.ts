import { createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { FieldCryptoError, type FieldKeyRing } from '../src/crypto/field.ts';
import { decryptFile, encryptFile, sniffPrivateFile } from '../src/crypto/file.ts';
import {
  cloudinaryPrivateStore,
  filePrivateStore,
  newLegalDocumentKey,
  privateStoreFromEnv,
} from '../src/media/private-store.ts';
import { cloudinarySignature } from '../src/media/store.ts';

// PHASE_08 T8.5 (04 §5, DECISIONS #40): legal-order documents — AES-256-GCM envelopes bound to their order (another
// context, a flipped byte or an unknown key never decrypts; old keys still do), the type by content only, and both
// private stores (a local directory the media site never serves; Cloudinary `raw` + `authenticated`, read back only
// through the signed API `download` endpoint — never a delivery URL).

const ORDER = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const CONTEXT = `legal_orders.document:${ORDER}`;
const FAKE_SECRET = 'not-a-real-secret-for-tests';
const ring = (currentId = 'k1', keys: [string, Buffer][] = [['k1', randomBytes(32)]]): FieldKeyRing => ({
  currentId,
  keys: new Map(keys),
});
const PDF = Buffer.from('%PDF-1.7\nTest document body');
const dirs: string[] = [];

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe('file encryption (T8.5)', () => {
  it('round-trips with its type; the envelope never contains the plaintext', () => {
    const keys = ring();
    const envelope = encryptFile(keys, PDF, 'pdf', CONTEXT);
    expect(envelope.subarray(0, 4).toString('ascii')).toBe('MCF2');
    expect(envelope.includes(Buffer.from('Test document'))).toBe(false);
    expect(decryptFile(keys, envelope, CONTEXT)).toEqual({ bytes: PDF, type: 'pdf' });
    // A fresh IV each time.
    expect(encryptFile(keys, PDF, 'pdf', CONTEXT).equals(envelope)).toBe(false);
  });

  it('the file key is derived (HKDF), never the field key itself — the ring key alone does not open it (#180 L7)', () => {
    const key = randomBytes(32);
    const envelope = encryptFile(ring('k1', [['k1', key]]), PDF, 'pdf', CONTEXT);
    const ivStart = 4 + 1 + 2; // magic, id length, "k1"
    const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(ivStart, ivStart + 12), {
      authTagLength: 16,
    });
    decipher.setAAD(Buffer.from(`mc-file:${CONTEXT}`, 'utf8'));
    decipher.setAuthTag(envelope.subarray(envelope.length - 16));
    decipher.update(envelope.subarray(ivStart + 12, envelope.length - 16));
    expect(() => decipher.final()).toThrow();
  });

  it('another order, a flipped byte, a truncated file or an unknown key never decrypt', () => {
    const keys = ring();
    const envelope = encryptFile(keys, PDF, 'pdf', CONTEXT);
    expect(() => decryptFile(keys, envelope, 'legal_orders.document:other')).toThrow(FieldCryptoError);
    for (const at of [8, envelope.length - 20, envelope.length - 1]) {
      const tampered = Buffer.from(envelope);
      tampered[at] = (tampered[at] ?? 0) ^ 1;
      expect(() => decryptFile(keys, tampered, CONTEXT)).toThrow(FieldCryptoError);
    }
    expect(() => decryptFile(keys, envelope.subarray(0, 20), CONTEXT)).toThrow(FieldCryptoError);
    expect(() => decryptFile(ring(), envelope, CONTEXT)).toThrow(FieldCryptoError);
  });

  it('after a key rotation the old key still opens older files', () => {
    const old = randomBytes(32);
    const envelope = encryptFile(ring('k1', [['k1', old]]), PDF, 'pdf', CONTEXT);
    const rotated = ring('k2', [
      ['k2', randomBytes(32)],
      ['k1', old],
    ]);
    expect(decryptFile(rotated, envelope, CONTEXT).bytes).toEqual(PDF);
  });

  it('sniffs PDF, JPEG and PNG by content only', () => {
    expect(sniffPrivateFile(PDF)).toBe('pdf');
    expect(sniffPrivateFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('jpeg');
    expect(sniffPrivateFile(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('png');
    expect(sniffPrivateFile(Buffer.from('<html><script>'))).toBeUndefined();
    expect(sniffPrivateFile(Buffer.from('PK\u0003\u0004'))).toBeUndefined(); // zip / docx
  });
});

describe('private stores (T8.5)', () => {
  it('local: under private/, never overwrites, delete is idempotent; keys are checked', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mc-private-'));
    dirs.push(dir);
    const store = filePrivateStore(dir);
    const key = newLegalDocumentKey(ORDER);
    await store.put(key, Buffer.from('cipher'));
    expect(await readdir(join(dir, 'private', 'legal', ORDER))).toHaveLength(1);
    await expect(store.put(key, Buffer.from('again'))).rejects.toThrow();
    expect((await store.get(key)).toString()).toBe('cipher');
    await store.delete(key);
    await store.delete(key);
    await expect(store.get('../masters/x.jpg')).rejects.toThrow(/malformed key/u);
  });

  it('Cloudinary: signed raw upload as `authenticated`; reads via the signed API download; destroy invalidates', async () => {
    const key = newLegalDocumentKey(ORDER);
    const calls: { url: string; method: string; form?: Record<string, unknown> }[] = [];
    const store = cloudinaryPrivateStore({
      cloudName: 'test-cloud',
      apiKey: '123',
      apiSecret: FAKE_SECRET,
      now: () => 1_700_000_000,
      fetch: (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const body = init?.body;
        calls.push({
          url,
          method: init?.method ?? 'GET',
          ...(body instanceof FormData ? { form: Object.fromEntries(body.entries()) } : {}),
        });
        expect(init?.redirect).toBe('error');
        if (url.includes('/download')) return Promise.resolve(new Response('cipher-bytes', { status: 200 }));
        const answer = url.endsWith('/upload') ? { public_id: key, type: 'authenticated', resource_type: 'raw' } : {};
        return Promise.resolve(Response.json(answer));
      },
    });
    await store.put(key, Buffer.from('cipher'));
    expect((await store.get(key)).toString()).toBe('cipher-bytes');
    await store.delete(key);

    const [upload, download, destroy] = calls;
    expect(upload?.url).toBe('https://api.cloudinary.com/v1_1/test-cloud/raw/upload');
    expect(upload?.form).toMatchObject({ public_id: key, type: 'authenticated', overwrite: 'false', api_key: '123' });
    expect(upload?.form?.['signature']).toBe(
      cloudinarySignature(
        { overwrite: 'false', public_id: key, timestamp: '1700000000', type: 'authenticated' },
        FAKE_SECRET,
      ),
    );
    const url = new URL(download?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.cloudinary.com/v1_1/test-cloud/raw/download');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      expires_at: '1700000300',
      public_id: key,
      timestamp: '1700000000',
      type: 'authenticated',
      api_key: '123',
      signature: cloudinarySignature(
        { expires_at: '1700000300', public_id: key, timestamp: '1700000000', type: 'authenticated' },
        FAKE_SECRET,
      ),
    });
    expect(destroy?.url).toBe('https://api.cloudinary.com/v1_1/test-cloud/raw/destroy');
    expect(destroy?.form).toMatchObject({ public_id: key, type: 'authenticated', invalidate: 'true' });
    // Never a delivery host.
    expect(calls.every((call) => call.url.startsWith('https://api.cloudinary.com/'))).toBe(true);
  });

  it('Cloudinary: a failed upload or download throws; a missing asset on destroy is fine', async () => {
    const store = cloudinaryPrivateStore({
      cloudName: 'test-cloud',
      apiKey: '123',
      apiSecret: FAKE_SECRET,
      fetch: () => Promise.resolve(new Response('', { status: 404 })),
    });
    const key = newLegalDocumentKey(ORDER);
    await expect(store.put(key, Buffer.from('x'))).rejects.toThrow(/HTTP 404/u);
    await expect(store.get(key)).rejects.toThrow(/HTTP 404/u);
    await expect(store.delete(key)).resolves.toBeUndefined();
  });

  it('Cloudinary: an upload answer that is not an authenticated asset under our key is refused (#180 L6)', async () => {
    const key = newLegalDocumentKey(ORDER);
    for (const answer of [
      { public_id: key, type: 'upload' },
      { public_id: 'other', type: 'authenticated' },
      {},
      'not json',
    ]) {
      const store = cloudinaryPrivateStore({
        cloudName: 'test-cloud',
        apiKey: '123',
        apiSecret: FAKE_SECRET,
        fetch: () =>
          Promise.resolve(typeof answer === 'string' ? new Response(answer, { status: 200 }) : Response.json(answer)),
      });
      await expect(store.put(key, Buffer.from('cipher')), JSON.stringify(answer)).rejects.toThrow(
        /not an authenticated asset/u,
      );
    }
  });

  it('Cloudinary: an oversized download is refused (by its header or its body); a failed destroy throws', async () => {
    const key = newLegalDocumentKey(ORDER);
    const big = 9 * 1024 * 1024 + 1;
    const store = (answer: () => Response) =>
      cloudinaryPrivateStore({
        cloudName: 'test-cloud',
        apiKey: '123',
        apiSecret: FAKE_SECRET,
        fetch: () => Promise.resolve(answer()),
      });
    await expect(
      store(() => new Response('x', { headers: { 'content-length': String(big) } })).get(key),
    ).rejects.toThrow(/too large/u);
    await expect(store(() => new Response(new Uint8Array(big))).get(key)).rejects.toThrow(/too large/u);
    await expect(store(() => new Response('', { status: 500 })).delete(key)).rejects.toThrow(/HTTP 500/u);
    // Without an injected clock the signature uses the real time; a small answer comes back as it is.
    await expect(store(() => new Response(new Uint8Array([1, 2, 3]))).get(key)).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    );
  });

  it('the store follows MEDIA_STORE; Cloudinary needs its keys', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mc-private-env-'));
    dirs.push(dir);
    const local = privateStoreFromEnv({ MEDIA_STORE: 'files', MEDIA_DIR: dir });
    const key = newLegalDocumentKey(ORDER);
    await local.put(key, PDF);
    expect(await local.get(key)).toEqual(PDF);
    expect(() => privateStoreFromEnv({ MEDIA_STORE: 'cloudinary', CLOUDINARY_CLOUD_NAME: 'c' })).toThrow(
      /needs the keys/u,
    );
    expect(
      privateStoreFromEnv({
        MEDIA_STORE: 'cloudinary',
        CLOUDINARY_CLOUD_NAME: 'c',
        CLOUDINARY_API_KEY: '1',
        CLOUDINARY_API_SECRET: FAKE_SECRET,
      }),
    ).toHaveProperty('get');
  });
});
