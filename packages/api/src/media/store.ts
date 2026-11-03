// Media storage (DECISIONS #40, 01 §5.5): one interface, two adapters. Cloudinary holds the sanitized master only —
// its strict named transformations make the delivery sizes; the local file store (dev, tests, the local stack) writes
// the same six variants itself, at the paths Caddy's media site serves (`/i/<width>/<format>/<key>.<format>`).
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { IMAGE_FORMATS, IMAGE_WIDTHS, renderVariant } from './image.ts';

/** `m/<masjidId>/<random uuid>` (01 §5.5) — the only key shape Caddy's media route lets through. */
export const IMAGE_KEY =
  /^m\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A new random key for one of `masjidId`'s images. */
export const newImageKey = (masjidId: string): string => `m/${masjidId}/${randomUUID()}`;

export interface MediaStore {
  /** Stores a sanitized master under `key` (never overwrites). */
  putImage(key: string, master: Buffer): Promise<void>;
  /** Removes the image and its delivery copies (missing is fine). */
  deleteImage(key: string): Promise<void>;
}

function assertKey(key: string): void {
  if (!IMAGE_KEY.test(key)) throw new Error('media: malformed image key');
}

/**
 * The local store: master + the six variants under `dir` (local dev and the local stack — `MEDIA_DIR`).
 *
 * @param dir - an absolute directory; every path written is checked to stay inside it.
 */
export function fileMediaStore(dir: string): MediaStore {
  const root = resolve(dir);
  const inside = (...parts: string[]) => {
    const path = resolve(root, ...parts);
    if (!path.startsWith(root + sep)) throw new Error('media: path outside the media directory');
    return path;
  };
  const variants = (key: string) =>
    IMAGE_WIDTHS.flatMap((width) =>
      IMAGE_FORMATS.map((format) => ({ width, format, path: inside('i', String(width), format, `${key}.${format}`) })),
    );
  return {
    async putImage(key, master) {
      assertKey(key);
      const masterPath = inside('masters', `${key}.jpg`);
      await mkdir(dirname(masterPath), { recursive: true });
      await writeFile(masterPath, master, { flag: 'wx' });
      for (const variant of variants(key)) {
        await mkdir(dirname(variant.path), { recursive: true });
        await writeFile(variant.path, await renderVariant(master, variant.width, variant.format), { flag: 'wx' });
      }
    },
    async deleteImage(key) {
      assertKey(key);
      for (const path of [inside('masters', `${key}.jpg`), ...variants(key).map((variant) => variant.path)]) {
        await rm(path, { force: true });
      }
    },
  };
}

export interface CloudinaryConfig {
  readonly cloudName: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  /** Injectable for tests. */
  readonly fetch?: typeof fetch;
  /** Seconds since the epoch (injectable for tests). */
  readonly now?: () => number;
}

/**
 * Cloudinary signature (DECISIONS #40): the signed parameters sorted by name as `name=value` joined with `&`, the API
 * secret appended, SHA-256 hex (Cloudinary tells SHA-1 and SHA-256 apart by length). `file`, `api_key`,
 * `resource_type` and `cloud_name` are never signed.
 */
export function cloudinarySignature(params: Readonly<Record<string, string>>, apiSecret: string): string {
  const payload = Object.keys(params)
    .sort()
    .map((name) => `${name}=${params[name] ?? ''}`)
    .join('&');
  return createHash('sha256')
    .update(payload + apiSecret)
    .digest('hex');
}

const CLOUDINARY_API = 'https://api.cloudinary.com/v1_1';
const TIMEOUT_MS = 20_000;

/**
 * The Cloudinary store: a server-side signed upload of the master (resource type `image`, public id = the key,
 * `overwrite=false`), and a signed destroy with CDN invalidation. Only the fixed API host is ever called (04 §6).
 */
export function cloudinaryMediaStore(config: CloudinaryConfig): MediaStore {
  const call = config.fetch ?? fetch;
  const now = config.now ?? (() => Math.floor(Date.now() / 1000));
  const signedForm = (params: Record<string, string>) => {
    const form = new FormData();
    for (const [name, value] of Object.entries(params)) form.set(name, value);
    form.set('api_key', config.apiKey);
    form.set('signature', cloudinarySignature(params, config.apiSecret));
    return form;
  };
  const post = async (action: 'upload' | 'destroy', form: FormData) => {
    const response = await call(`${CLOUDINARY_API}/${encodeURIComponent(config.cloudName)}/image/${action}`, {
      method: 'POST',
      body: form,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`cloudinary ${action} failed with HTTP ${String(response.status)}`);
    return response;
  };
  return {
    async putImage(key, master) {
      assertKey(key);
      const form = signedForm({ overwrite: 'false', public_id: key, timestamp: String(now()) });
      form.set('file', new Blob([new Uint8Array(master)], { type: 'image/jpeg' }), 'master.jpg');
      await post('upload', form);
    },
    async deleteImage(key) {
      assertKey(key);
      await post('destroy', signedForm({ invalidate: 'true', public_id: key, timestamp: String(now()) }));
    },
  };
}

/**
 * The store for this process (`MEDIA_STORE`, validated by the env schema): `cloudinary` outside local; locally the
 * file store by default, so local work never touches the real Cloudinary account even when its keys are present.
 *
 * @throws Error when `cloudinary` is chosen without its three credentials (the env schema already refuses that).
 */
export function mediaStoreFromEnv(env: {
  readonly MEDIA_STORE: 'cloudinary' | 'files';
  readonly MEDIA_DIR?: string | undefined;
  readonly CLOUDINARY_CLOUD_NAME?: string | undefined;
  readonly CLOUDINARY_API_KEY?: string | undefined;
  readonly CLOUDINARY_API_SECRET?: string | undefined;
}): MediaStore {
  if (env.MEDIA_STORE === 'files') return fileMediaStore(env.MEDIA_DIR ?? join(process.cwd(), '.media'));
  const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = env;
  if (!cloudName || !apiKey || !apiSecret) throw new Error('media: MEDIA_STORE=cloudinary needs the Cloudinary keys');
  return cloudinaryMediaStore({ cloudName, apiKey, apiSecret });
}
