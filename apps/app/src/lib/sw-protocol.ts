// What the musalli service worker and the page agree on (01 §5.6, PHASE_02 T2.13). Imported by both bundles, so it
// holds constants and pure functions only — no DOM, no worker globals, no dependencies.

/**
 * Response header the service worker adds to API responses it answers from Cache Storage:
 * - `cache` — a stored versioned (immutable) response; says nothing about the network;
 * - `fallback` — the network failed or timed out (versions endpoint, NetworkFirst) and the stored answer was used.
 *
 * Either way the response's `Date` is from when it was stored, not from now.
 */
export const SW_SOURCE_HEADER = 'X-MC-SW';
export type SwSource = 'cache' | 'fallback';

/** The worker's runtime caches (versioned names, so a layout change can drop them). */
export const SW_CACHES = {
  assets: 'mc-assets-v1',
  images: 'mc-images-v1',
  api: 'mc-api-v1',
  versions: 'mc-versions-v1',
} as const;

/**
 * Caches that reveal which masjids this phone follows (feeds, bundles, the versions URL listing the ids, masjid photos)
 * — emptied by "Clear all data" (05 §4). App code and fonts (`assets`) stay.
 */
export const PERSONAL_CACHES = [SW_CACHES.api, SW_CACHES.versions, SW_CACHES.images] as const;

/** Background Sync tag: Ameens said offline are sent by the worker when the connection returns (01 §5.6). */
export const AMEEN_SYNC_TAG = 'mc-ameen';

/** The device document's IndexedDB database, object store and key (`lib/device`). */
export const DEVICE_DB = 'mc-device';
export const DEVICE_DB_STORE = 'kv';
export const DEVICE_KEY = 'device';

/** What the worker needs from the device document to send queued Ameens. */
export interface QueuedAmeens {
  readonly authorization: string;
  readonly publicIds: readonly string[];
}

// The same formats as the device store's schema (`uuidText`, `publicIdText` in @mc/shared — not imported: Zod would
// enter the worker bundle).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const PUBLIC_ID = /^[A-Za-z0-9_-]{12}$/;

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && Object.hasOwn(value, key) ? Reflect.get(value, key) : undefined;

/**
 * Reads the queued Ameens and the device credentials from a stored device document (04 §11: never trusted unparsed —
 * the page validates the whole document with its schema; the worker checks just the fields it sends).
 *
 * @returns `null` when the device is not registered, nothing is queued, or the document does not look right.
 */
export function queuedAmeens(device: unknown): QueuedAmeens | null {
  const credentials = field(device, 'credentials');
  const deviceId = field(credentials, 'deviceId');
  const secret = field(credentials, 'secret');
  const pending = field(device, 'pendingAmeens');
  if (typeof deviceId !== 'string' || !UUID.test(deviceId)) return null;
  if (typeof secret !== 'string' || !SECRET.test(secret)) return null;
  if (!Array.isArray(pending)) return null;
  const publicIds = pending.filter((id): id is string => typeof id === 'string' && PUBLIC_ID.test(id));
  if (publicIds.length === 0) return null;
  return { authorization: `Device ${deviceId}.${secret}`, publicIds };
}
