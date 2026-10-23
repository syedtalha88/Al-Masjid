// Persisted TanStack Query cache (01 §5.6, T2.3, T2.10): successful versioned/content queries are kept in IndexedDB so
// Home, timings and feeds render instantly and offline. One entry per query (`q:<hash>`): a change writes only that
// query, never the whole cache — rewriting everything after each versions poll structured-cloned the entire cache on the
// main thread (hundreds of ms on a low-end phone, found by the T2.10 fling trace). Writes are batched (1 s); entries of
// another release (buster) or older than 30 days are dropped on restore.
import { hydrate, type Query, QueryClient, type QueryState } from '@tanstack/react-query';

import { PERSISTED_ROOTS } from '../api/keys.ts';
import type { KeyValueBackend } from '../device/store.ts';

export const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PREFIX = 'q:';
const THROTTLE_MS = 1000;

interface StoredQuery {
  readonly buster: string;
  readonly savedAt: number;
  readonly queryKey: readonly unknown[];
  readonly queryHash: string;
  readonly state: QueryState;
}

/** Shape check of a stored entry (04 §11: IndexedDB data is validated on read; queries re-validate their data on use). */
function isStoredQuery(value: unknown): value is StoredQuery {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<Record<keyof StoredQuery, unknown>>; // checked field by field below
  return (
    typeof entry.buster === 'string' &&
    typeof entry.savedAt === 'number' &&
    Array.isArray(entry.queryKey) &&
    typeof entry.queryHash === 'string' &&
    typeof entry.state === 'object' &&
    entry.state !== null &&
    (entry.state as { status?: unknown }).status === 'success'
  );
}

export interface QueryPersistence {
  /** Loads the stored queries into the client (before the app renders); drops stale or foreign entries. Never throws. */
  restore(client: QueryClient): Promise<void>;
  /** Writes successful content queries as they change; returns a stop function (flushes what is pending). */
  start(client: QueryClient): () => void;
}

export interface QueryPersistenceOptions {
  /** Release stamp — entries of another release are dropped. */
  readonly buster: string;
  readonly maxAgeMs?: number;
  readonly throttleMs?: number;
  readonly now?: () => number;
}

/** Per-query persistence over a key-value backend (IndexedDB in the app). A broken store is just no cache. */
export function createQueryPersistence(backend: KeyValueBackend, options: QueryPersistenceOptions): QueryPersistence {
  const maxAge = options.maxAgeMs ?? CACHE_MAX_AGE_MS;
  const throttle = options.throttleMs ?? THROTTLE_MS;
  const now = options.now ?? (() => Date.now());
  return {
    async restore(client) {
      try {
        const keep: StoredQuery[] = [];
        const drop: string[] = [];
        for (const [key, value] of await backend.entries()) {
          const fresh =
            key.startsWith(PREFIX) &&
            isStoredQuery(value) &&
            value.buster === options.buster &&
            now() - value.savedAt <= maxAge;
          if (fresh) keep.push(value);
          else drop.push(key); // stale, another release, or an older cache format
        }
        if (keep.length > 0) {
          hydrate(client, {
            mutations: [],
            queries: keep.map((entry) => ({
              queryKey: [...entry.queryKey],
              queryHash: entry.queryHash,
              state: entry.state,
              dehydratedAt: entry.savedAt,
            })),
          });
        }
        if (drop.length > 0) await backend.delMany(drop);
      } catch {
        // No cache this time.
      }
    },
    start(client) {
      const pending = new Map<string, StoredQuery | null>(); // null = delete
      let timer: ReturnType<typeof setTimeout> | undefined;
      const flush = async () => {
        timer = undefined;
        const batch = [...pending];
        pending.clear();
        const writes = batch.flatMap(([key, value]) => (value ? [[key, value] as const] : []));
        const removals = batch.flatMap(([key, value]) => (value ? [] : [key]));
        try {
          if (writes.length > 0) await backend.setMany(writes);
          if (removals.length > 0) await backend.delMany(removals);
        } catch {
          // Storage full or unavailable: the app works without the cache.
        }
      };
      const schedule = () => {
        timer ??= setTimeout(() => void flush(), throttle);
      };
      const unsubscribe = client.getQueryCache().subscribe((event) => {
        // The cache types its queries loosely (`Query<any, …>`); only the key, hash and state are read.
        const query = event.query as Query;
        const queryKey: readonly unknown[] = query.queryKey;
        if (!PERSISTED_ROOTS.has(String(queryKey[0]))) return;
        if (event.type === 'removed') {
          pending.set(PREFIX + query.queryHash, null);
          schedule();
        } else if (event.type === 'updated' && event.action.type === 'success') {
          pending.set(PREFIX + query.queryHash, {
            buster: options.buster,
            savedAt: now(),
            queryKey,
            queryHash: query.queryHash,
            state: { ...query.state, fetchStatus: 'idle' },
          });
          schedule();
        }
      });
      return () => {
        unsubscribe();
        if (timer) clearTimeout(timer);
        void flush();
      };
    },
  };
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
