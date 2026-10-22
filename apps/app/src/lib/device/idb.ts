// IndexedDB backends (idb-keyval 6.3) for the device store and the persisted query cache. Two databases so clearing
// the device (Clear all data) and dropping the cache are independent. When IndexedDB is unavailable (some private
// modes) the store falls back to memory (00 §7).
import { createStore, del, get, set, type UseStore } from 'idb-keyval';

import { type KeyValueBackend, memoryBackend } from './store.ts';

/** True when this browser can open IndexedDB at all. */
export const hasIndexedDb = (): boolean => typeof indexedDB !== 'undefined';

/** A key-value backend in its own IndexedDB database. */
export function idbBackend(database: string): KeyValueBackend {
  if (!hasIndexedDb()) return memoryBackend();
  let store: UseStore | undefined;
  const storeOf = () => (store ??= createStore(database, 'kv'));
  return {
    get: (key) => get<unknown>(key, storeOf()),
    set: (key, value) => set(key, value, storeOf()),
    del: (key) => del(key, storeOf()),
  };
}

/** The device document's database. */
export const DEVICE_DB = 'mc-device';
/** The persisted TanStack Query cache's database (01 §5.6). */
export const QUERY_CACHE_DB = 'mc-query-cache';
