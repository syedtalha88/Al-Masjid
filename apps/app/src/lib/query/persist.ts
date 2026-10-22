// Persisted TanStack Query cache (01 §5.6, T2.3): successful versioned/content queries are written to IndexedDB so
// Home, timings and feeds render instantly and offline. Max age 30 days; the buster is the app release, so a new
// build never reads a cache shaped by an older one. Writes are throttled (1 s).
import { QueryClient } from '@tanstack/react-query';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

import { PERSISTED_ROOTS } from '../api/keys.ts';
import type { KeyValueBackend } from '../device/store.ts';

export const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_KEY = 'queries';
const THROTTLE_MS = 1000;

/** A persister over a key-value backend (IndexedDB in the app). Never throws: a broken cache is just no cache. */
export function createPersister(backend: KeyValueBackend, throttleMs = THROTTLE_MS): Persister {
  let pending: PersistedClient | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = async () => {
    timer = undefined;
    const value = pending;
    pending = undefined;
    if (value) await backend.set(CACHE_KEY, value).catch(() => undefined);
  };
  return {
    persistClient(client) {
      pending = client;
      timer ??= setTimeout(() => void flush(), throttleMs);
    },
    async restoreClient() {
      try {
        const value = await backend.get(CACHE_KEY);
        return isPersistedClient(value) ? value : undefined;
      } catch {
        return undefined;
      }
    },
    async removeClient() {
      pending = undefined;
      await backend.del(CACHE_KEY).catch(() => undefined);
    },
  };
}

/** Shape check of a stored cache (04 §11: IndexedDB data is validated on read; queries re-validate on use). */
function isPersistedClient(value: unknown): value is PersistedClient {
  return (
    typeof value === 'object' &&
    value !== null &&
    'timestamp' in value &&
    typeof value.timestamp === 'number' &&
    'buster' in value &&
    typeof value.buster === 'string' &&
    'clientState' in value &&
    typeof value.clientState === 'object' &&
    value.clientState !== null
  );
}

/** Only successful queries of the persisted roots go to disk. */
export const shouldPersistQuery = (query: { queryKey: readonly unknown[]; state: { status: string } }): boolean =>
  query.state.status === 'success' && PERSISTED_ROOTS.has(String(query.queryKey[0]));

/** The release stamped into index.html (`<meta name="mc-release">`, DECISIONS #46) — the cache buster. */
export const appRelease = (): string =>
  document.querySelector<HTMLMetaElement>('meta[name="mc-release"]')?.content ?? 'dev';

/** The app's query client (staleTime per resource is set by each query; persisted data is kept 30 days). */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        // ≥ the persisted max age (TanStack's rule); longer than a timer can wait, so never garbage-collected — old
        // content versions are pruned explicitly (queries.ts).
        gcTime: Number.POSITIVE_INFINITY,
        retry: false, // the API client retries GETs itself (03 §7)
        refetchOnWindowFocus: true,
        networkMode: 'offlineFirst',
      },
      mutations: { retry: 0, networkMode: 'offlineFirst' },
    },
  });
}
