// Ameen state for dua cards and the dua detail (07 A9, 08 §5.6): this device's choice (device store), the live counts
// (`GET /ameens`, ≤ 30 ids per request, 30 s at the CDN) and the exact counts the server confirmed for our own
// Ameens this session — so a slightly old CDN answer never rolls a number back.
import { queryOptions, useQueries } from '@tanstack/react-query';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { ApiClient } from '../../../lib/api/client.ts';
import { queryKeys } from '../../../lib/api/keys.ts';
import { useAppData, useDeviceSelector } from '../../../lib/data.tsx';
import { ameenDisplayCount, flushAmeens, sayAmeenLocally } from '../../../lib/device/ameen.ts';

/** 03 §3 `GET /ameens?items=` accepts up to 30 ids. */
const IDS_PER_REQUEST = 30;
const COUNTS_STALE_MS = 30_000;

const ameenCountsQuery = (api: ApiClient, ids: readonly string[]) =>
  queryOptions({
    queryKey: queryKeys.ameenCounts(ids),
    queryFn: ({ signal }) => api.ameenCounts(ids, signal),
    staleTime: COUNTS_STALE_MS,
    enabled: ids.length > 0,
  });

// Exact counts returned by `POST /items/:id/ameen` (this session).
const confirmed = new Map<string, number>();
const listeners = new Set<() => void>();
let confirmedVersion = 0;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function recordConfirmed(counts: ReadonlyMap<string, number>) {
  if (counts.size === 0) return;
  for (const [id, count] of counts) confirmed.set(id, Math.max(confirmed.get(id) ?? 0, count));
  confirmedVersion += 1;
  for (const listener of listeners) listener();
}

export interface AmeenApi {
  readonly said: (publicId: string) => boolean;
  /** The count to show (`undefined` while unknown). */
  readonly count: (publicId: string) => number | undefined;
  /** Says Ameen (once per device): recorded at once, sent now or later. */
  readonly say: (publicId: string) => void;
}

/** Ameen state for the dua requests on screen. */
export function useAmeen(publicIds: readonly string[]): AmeenApi {
  const { api, store, sync } = useAppData();
  const ameens = useDeviceSelector((state) => state.ameens);
  const pending = useDeviceSelector((state) => state.pendingAmeens);
  const version = useSyncExternalStore(
    subscribe,
    () => confirmedVersion,
    () => confirmedVersion,
  );

  const chunks = useMemo(() => {
    const sorted = [...new Set(publicIds)].sort();
    const result: string[][] = [];
    for (let index = 0; index < sorted.length; index += IDS_PER_REQUEST) {
      result.push(sorted.slice(index, index + IDS_PER_REQUEST));
    }
    return result;
  }, [publicIds]);
  const queries = useQueries({ queries: chunks.map((ids) => ameenCountsQuery(api, ids)) });
  const server = useMemo(() => {
    const counts = new Map<string, number>();
    queries.forEach((query, index) => {
      if (!query.data) return;
      // An id the server does not list has no Ameen yet.
      for (const id of chunks[index] ?? []) counts.set(id, query.data.counts[id] ?? 0);
    });
    return counts;
  }, [queries, chunks]);

  const said = useCallback((publicId: string) => ameens.includes(publicId), [ameens]);
  const count = useCallback(
    (publicId: string) => ameenDisplayCount(server.get(publicId), confirmed.get(publicId), pending.includes(publicId)),
    // `version` changes whenever a confirmed count arrives (the map itself is module state).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
    [server, pending, version],
  );
  const say = useCallback(
    (publicId: string) => {
      void (async () => {
        if (!(await sayAmeenLocally(store, publicId))) return;
        recordConfirmed((await flushAmeens(sync)).confirmed);
      })().catch(() => undefined);
    },
    [store, sync],
  );
  return useMemo(() => ({ said, count, say }), [said, count, say]);
}
