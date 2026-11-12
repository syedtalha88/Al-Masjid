// Media storage (DECISIONS #40, 01 §5.5): one interface, two adapters. Cloudinary holds the sanitized master only —
// its strict named transformations make the delivery sizes; the local file store (dev, tests, the local stack) writes
// the same six variants itself, at the paths Caddy's media site serves (`/i/<width>/<format>/<key>.<format>`).
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { AUDIO_KEY, IMAGE_KEY } from '@mc/shared/contracts';

import { AUDIO_MIME, type SniffedAudio } from './audio.ts';
import { IMAGE_FORMATS, IMAGE_WIDTHS, renderVariant } from './image.ts';

export { AUDIO_KEY, IMAGE_KEY };

/** A new random key for one of `masjidId`'s images. */
export const newImageKey = (masjidId: string): string => `m/${masjidId}/${randomUUID()}`;
/** A new random key for one of `masjidId`'s voice notes (01 §5.5 Audio). */
export const newAudioKey = (masjidId: string): string => `m/${masjidId}/a/${randomUUID()}`;

export interface MediaStore {
  /** Stores a sanitized master under `key` (never overwrites). */
  putImage(key: string, master: Buffer): Promise<void>;
  /** Removes the image and its delivery copies (missing is fine). */
  deleteImage(key: string): Promise<void>;
  /**
   * Stores a recording under `key` (never overwrites).
   *
   * @returns the duration the storage measured itself (Cloudinary), when it did.
   */
  putAudio(key: string, bytes: Buffer, type: SniffedAudio): Promise<{ readonly durationS?: number }>;
  /** Removes the recording and its delivery copy (missing is fine). */
  deleteAudio(key: string): Promise<void>;
  /**
   * Takedown (F73, PHASE_08 T8.2): the image is no longer delivered at all — kept privately for the 180-day
   * preservation — until `unrestrictImage` (missing or already restricted is fine).
   */
  restrictImage(key: string): Promise<void>;
  /** Restore after a takedown: delivered again (missing or not restricted is fine). */
  unrestrictImage(key: string): Promise<void>;
  /** Takedown (F73): the recording is no longer delivered (missing or already restricted is fine). */
  restrictAudio(key: string): Promise<void>;
  /** Restore after a takedown (missing or not restricted is fine). */
  unrestrictAudio(key: string): Promise<void>;
}

function assertKey(key: string): void {
  if (!IMAGE_KEY.test(key)) throw new Error('media: malformed image key');
}
function assertAudioKey(key: string): void {
  if (!AUDIO_KEY.test(key)) throw new Error('media: malformed audio key');
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
  const imagePaths = (key: string) => [
    inside('masters', `${key}.jpg`),
    ...variants(key).map((variant) => variant.path),
  ];
  /** The same file under `restricted/` (checked to stay inside the directory). */
  const restricted = (path: string) => inside('restricted', relative(root, path));
  /** Moves a file if it is there (a missing one is fine — takedown and restore are idempotent). */
  const move = async (from: string, to: string) => {
    try {
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; // fs errors carry `code`
    }
  };
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
      for (const path of imagePaths(key)) {
        await rm(path, { force: true });
        await rm(restricted(path), { force: true });
      }
    },
    // Locally the recording is served as uploaded at its delivery path (no AAC re-encode — the browser that recorded
    // it plays it); the duration is the browser's.
    async putAudio(key, bytes) {
      assertAudioKey(key);
      const path = inside('a', 'm4a', key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes, { flag: 'wx' });
      return {};
    },
    async deleteAudio(key) {
      assertAudioKey(key);
      await rm(inside('a', 'm4a', key), { force: true });
      await rm(restricted(inside('a', 'm4a', key)), { force: true });
    },
    // Takedown locally: the files move under `restricted/`, which the media site never serves (Caddy serves
    // `/i/…` and `/a/…` only).
    async restrictImage(key) {
      assertKey(key);
      for (const path of imagePaths(key)) await move(path, restricted(path));
    },
    async unrestrictImage(key) {
      assertKey(key);
      for (const path of imagePaths(key)) await move(restricted(path), path);
    },
    async restrictAudio(key) {
      assertAudioKey(key);
      const path = inside('a', 'm4a', key);
      await move(path, restricted(path));
    },
    async unrestrictAudio(key) {
      assertAudioKey(key);
      const path = inside('a', 'm4a', key);
      await move(restricted(path), path);
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
  const post = async (
    action: 'upload' | 'destroy' | 'rename',
    form: FormData,
    resource: 'image' | 'video' = 'image',
    options: { readonly missingIsFine?: boolean } = {},
  ) => {
    const response = await call(`${CLOUDINARY_API}/${encodeURIComponent(config.cloudName)}/${resource}/${action}`, {
      method: 'POST',
      body: form,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (options.missingIsFine && response.status === 404) return response;
    if (!response.ok) throw new Error(`cloudinary ${action} failed with HTTP ${String(response.status)}`);
    return response;
  };
  /**
   * Takedown / restore (F73): the Upload API `rename` to the same public id with a new delivery type — `authenticated`
   * is never delivered without a signed URL (we sign none), and `invalidate` drops Cloudinary's CDN copies of the
   * asset and its transformations (verified against Cloudinary's docs, 13 Nov 2026). A missing asset (already moved,
   * or never stored) is fine: both directions are idempotent.
   */
  const moveType = (key: string, from: string, to: string, resource: 'image' | 'video') =>
    post(
      'rename',
      signedForm({
        from_public_id: key,
        invalidate: 'true',
        timestamp: String(now()),
        to_public_id: key,
        to_type: to,
        type: from,
      }),
      resource,
      { missingIsFine: true },
    );
  return {
    async putImage(key, master) {
      assertKey(key);
      const form = signedForm({ overwrite: 'false', public_id: key, timestamp: String(now()) });
      form.set('file', new Blob([new Uint8Array(master)], { type: 'image/jpeg' }), 'master.jpg');
      await post('upload', form);
    },
    async deleteImage(key) {
      assertKey(key);
      // Both delivery types: a removed post's image was moved to `authenticated` at its takedown (F73).
      for (const type of ['upload', 'authenticated']) {
        await post('destroy', signedForm({ invalidate: 'true', public_id: key, timestamp: String(now()), type }));
      }
    },
    // Audio is Cloudinary's `video` resource type, uploaded as `private`: the original (as recorded — container
    // metadata, a video track in an MP4) is never deliverable without a signed URL; only the derived AAC rendition
    // (named transformation `t_audio_m4a`) is public (01 §5.5, 04 R14, DECISIONS #135).
    async putAudio(key, bytes, type) {
      assertAudioKey(key);
      const form = signedForm({ overwrite: 'false', public_id: key, timestamp: String(now()), type: 'private' });
      form.set('file', new Blob([bytes], { type: AUDIO_MIME[type] }), `voice.${type}`);
      const response = await post('upload', form, 'video');
      const body: unknown = await response.json().catch(() => null);
      // Not documented as an upload response field for audio (checked 4 Nov 2026): used only when it is there.
      const duration = typeof body === 'object' && body !== null && 'duration' in body ? body.duration : undefined;
      return typeof duration === 'number' && Number.isFinite(duration) ? { durationS: duration } : {};
    },
    async deleteAudio(key) {
      assertAudioKey(key);
      for (const type of ['private', 'authenticated']) {
        await post(
          'destroy',
          signedForm({ invalidate: 'true', public_id: key, timestamp: String(now()), type }),
          'video',
        );
      }
    },
    async restrictImage(key) {
      assertKey(key);
      await moveType(key, 'upload', 'authenticated', 'image');
    },
    async unrestrictImage(key) {
      assertKey(key);
      await moveType(key, 'authenticated', 'upload', 'image');
    },
    // Recordings are stored `private` (their public AAC rendition is derived): restricted = `authenticated`.
    async restrictAudio(key) {
      assertAudioKey(key);
      await moveType(key, 'private', 'authenticated', 'video');
    },
    async unrestrictAudio(key) {
      assertAudioKey(key);
      await moveType(key, 'authenticated', 'private', 'video');
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
