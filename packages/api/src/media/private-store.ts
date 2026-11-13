// Private files (DECISIONS #40, 04 §5, PHASE_08 T8.5): encrypted legal-order documents. Two adapters behind one
// interface: Cloudinary (`raw` resource, delivery type `authenticated` — never delivered by its public URL; read back
// only by api-admin through the signed `download` endpoint of the API host, whose URL never leaves the process) and a
// local directory outside every path the media site serves (dev, tests, the local stack). Storage only ever sees
// ciphertext (`crypto/file.ts`).
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { z } from 'zod';

import { type CloudinaryConfig, cloudinarySignature } from './store.ts';

/** `legal/<orderId>/<random>.bin` — the extension is part of a raw asset's public id. */
export const PRIVATE_KEY = /^legal\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.bin$/u;
/** A new key for a document of order `orderId` (a new key per upload: never overwrites). */
export const newLegalDocumentKey = (orderId: string): string => `legal/${orderId}/${randomUUID()}.bin`;

export interface PrivateFileStore {
  /** Stores `bytes` (already encrypted) under `key`; never overwrites. */
  put(key: string, bytes: Buffer): Promise<void>;
  /** The stored bytes. @throws Error when missing or unreadable. */
  get(key: string): Promise<Buffer>;
  /** Removes the file (missing is fine). */
  delete(key: string): Promise<void>;
}

function assertKey(key: string): void {
  if (!PRIVATE_KEY.test(key)) throw new Error('private files: malformed key');
}

/** Upper bound on what is read back (8 MB documents + the envelope). */
const MAX_READ_BYTES = 9 * 1024 * 1024;

/**
 * The local store under `<dir>/private/` — Caddy's media site serves `/i/…` and `/a/…` only.
 *
 * @param dir - the media directory (`MEDIA_DIR`); every path is checked to stay inside it.
 */
export function filePrivateStore(dir: string): PrivateFileStore {
  const root = resolve(dir, 'private');
  const inside = (key: string) => {
    assertKey(key);
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new Error('private files: path outside the directory');
    return path;
  };
  return {
    async put(key, bytes) {
      const path = inside(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes, { flag: 'wx' });
    },
    async get(key) {
      return readFile(inside(key));
    },
    async delete(key) {
      await rm(inside(key), { force: true });
    },
  };
}

const CLOUDINARY_API = 'https://api.cloudinary.com/v1_1';
/** The fields of Cloudinary's upload answer we check (the rest is ignored). */
const UPLOAD_ANSWER = z.object({ public_id: z.string(), type: z.string() });
const TIMEOUT_MS = 30_000;

/**
 * The Cloudinary store: signed upload / destroy on the fixed API host (`raw`, `type=authenticated`,
 * `overwrite=false`), and reads through the signed `raw/download` endpoint (the `private_download_url` form, checked
 * against Cloudinary's docs 13 Nov 2026: answers with the bytes; time-limited by `expires_at`). Redirects are refused.
 */
export function cloudinaryPrivateStore(config: CloudinaryConfig): PrivateFileStore {
  const call = config.fetch ?? fetch;
  const now = config.now ?? (() => Math.floor(Date.now() / 1000));
  const base = `${CLOUDINARY_API}/${encodeURIComponent(config.cloudName)}/raw`;
  const signed = (params: Record<string, string>) => ({
    ...params,
    api_key: config.apiKey,
    signature: cloudinarySignature(params, config.apiSecret),
  });
  const form = (params: Record<string, string>) => {
    const body = new FormData();
    for (const [name, value] of Object.entries(signed(params))) body.set(name, value);
    return body;
  };
  return {
    async put(key, bytes) {
      assertKey(key);
      const body = form({ overwrite: 'false', public_id: key, timestamp: String(now()), type: 'authenticated' });
      body.set('file', new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }), 'document.bin');
      const response = await call(`${base}/upload`, {
        method: 'POST',
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`cloudinary raw upload failed with HTTP ${String(response.status)}`);
      // Stored as asked — `authenticated` (never delivered by a public URL) under our key (DECISIONS #180 L6).
      const answer = UPLOAD_ANSWER.safeParse(await response.json().catch(() => null));
      if (!answer.success || answer.data.type !== 'authenticated' || answer.data.public_id !== key) {
        throw new Error('cloudinary raw upload answer is not an authenticated asset under the requested key');
      }
    },
    async get(key) {
      assertKey(key);
      const at = now();
      const query = new URLSearchParams(
        signed({ expires_at: String(at + 300), public_id: key, timestamp: String(at), type: 'authenticated' }),
      );
      const response = await call(`${base}/download?${query.toString()}`, {
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`cloudinary raw download failed with HTTP ${String(response.status)}`);
      const length = Number(response.headers.get('content-length') ?? '0');
      if (length > MAX_READ_BYTES) throw new Error('cloudinary raw download too large');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_READ_BYTES) throw new Error('cloudinary raw download too large');
      return bytes;
    },
    async delete(key) {
      assertKey(key);
      const response = await call(`${base}/destroy`, {
        method: 'POST',
        body: form({ invalidate: 'true', public_id: key, timestamp: String(now()), type: 'authenticated' }),
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`cloudinary raw destroy failed with HTTP ${String(response.status)}`);
      }
    },
  };
}

/** The store for this process (same switch as the media store: `MEDIA_STORE`). */
export function privateStoreFromEnv(env: {
  readonly MEDIA_STORE: 'cloudinary' | 'files';
  readonly MEDIA_DIR?: string | undefined;
  readonly CLOUDINARY_CLOUD_NAME?: string | undefined;
  readonly CLOUDINARY_API_KEY?: string | undefined;
  readonly CLOUDINARY_API_SECRET?: string | undefined;
}): PrivateFileStore {
  if (env.MEDIA_STORE === 'files') return filePrivateStore(env.MEDIA_DIR ?? join(process.cwd(), '.media'));
  const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = env;
  if (!cloudName || !apiKey || !apiSecret) throw new Error('private files: MEDIA_STORE=cloudinary needs the keys');
  return cloudinaryPrivateStore({ cloudName, apiKey, apiSecret });
}
