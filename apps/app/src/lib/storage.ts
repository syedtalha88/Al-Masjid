// Persistent storage (01 §5.6): after the first follow the app asks the browser to keep its data (device credentials,
// follows, the cached timings) under storage pressure instead of evicting it. Chromium decides silently (installed
// apps and engaged sites are granted), Safari grants installed web apps, Firefox may ask once and remembers.

type StorageLike = Pick<StorageManager, 'persist' | 'persisted'>;

/**
 * Requests persistent storage unless it is already granted.
 *
 * @returns whether this origin's storage is persistent now; `false` when the browser has no Storage API, refuses, or
 *   throws (never rejects).
 */
export async function requestPersistentStorage(
  storage: StorageLike | undefined = typeof navigator === 'undefined' ? undefined : navigator.storage,
): Promise<boolean> {
  // Older Safari has `navigator.storage` without `persist`.
  if (typeof storage?.persist !== 'function' || typeof storage.persisted !== 'function') return false;
  try {
    return (await storage.persisted()) || (await storage.persist());
  } catch {
    return false;
  }
}
