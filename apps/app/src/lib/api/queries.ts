// Query definitions (T2.3): versions polling and the versioned resources it targets (01 §5.2). The versions endpoint
// is polled on focus and every 60 s while the page is visible (and after a push from Phase 4); each masjid's bundle
// and feed queries carry `v`, so a changed version makes screens fetch exactly the changed masjids. Queries of older
// versions are pruned so the persisted cache does not grow.
import type { ItemType, MasjidBundle, MasjidVersions } from '@mc/shared/contracts/public';
import { type QueryClient, queryOptions } from '@tanstack/react-query';

import type { ApiClient } from './client.ts';
import { queryKeys } from './keys.ts';

/** 01 §5.2: polled every 60 s while visible; the CDN answer is at most 15 s old. */
export const VERSIONS_POLL_MS = 60_000;

export const versionsQuery = (api: ApiClient, masjidIds: readonly string[]) =>
  queryOptions({
    queryKey: queryKeys.versions(masjidIds),
    queryFn: ({ signal }) => api.versions(masjidIds, signal),
    enabled: masjidIds.length > 0,
    staleTime: 15_000,
    refetchInterval: VERSIONS_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
  });

/** Immutable per version: never refetched while the version stands. */
export const bundleQuery = (api: ApiClient, masjidId: string, v: number) =>
  queryOptions({
    queryKey: queryKeys.bundle(masjidId, v),
    queryFn: ({ signal }) => api.bundle(masjidId, v, signal),
    staleTime: Number.POSITIVE_INFINITY,
  });

/**
 * The newest cached bundle of `masjidId` older than `v` — the placeholder while version `v` loads, so a version bump
 * never blanks Home's card or resets the timings tab the musalli is on (T3.3). Read from the cache, not from the
 * observer: `useQueries` gives a changed key a new observer, which has no previous data.
 */
export function previousBundle(client: QueryClient, masjidId: string, v: number): MasjidBundle | undefined {
  let newest: { readonly v: number; readonly data: MasjidBundle } | null = null;
  for (const [key, data] of client.getQueriesData<MasjidBundle>({ queryKey: queryKeys.bundle(masjidId) })) {
    const version = key[2];
    if (data === undefined || typeof version !== 'number' || version >= v) continue;
    if (newest === null || version > newest.v) newest = { v: version, data };
  }
  return newest?.data;
}

/** A19 Ruqyah (T3.15): immutable per version, kept offline once opened. */
export const ruqyahQuery = (api: ApiClient, masjidId: string, v: number) =>
  queryOptions({
    queryKey: queryKeys.ruqyah(masjidId, v),
    queryFn: ({ signal }) => api.ruqyah(masjidId, v, signal),
    staleTime: Number.POSITIVE_INFINITY,
  });

/** A23 needy people (T5.8): immutable per version (a person who reaches their cap bumps it), kept offline once opened. */
export const needyQuery = (api: ApiClient, masjidId: string, v: number) =>
  queryOptions({
    queryKey: queryKeys.needy(masjidId, v),
    queryFn: ({ signal }) => api.beneficiaries(masjidId, v, signal),
    staleTime: Number.POSITIVE_INFINITY,
  });

/** One feed page (the first page is what Home and Updates show offline). */
export const feedQuery = (api: ApiClient, masjidId: string, v: number, aud: 'brothers' | 'sisters', type?: ItemType) =>
  queryOptions({
    queryKey: queryKeys.feed(masjidId, v, aud, type),
    queryFn: ({ signal }) => api.feed(masjidId, { v, aud, ...(type ? { type } : {}) }, signal),
    staleTime: Number.POSITIVE_INFINITY,
  });

/** A later feed page (Updates infinite scroll): the first page's key plus the cursor — pruned with its version. */
export const feedPageQuery = (
  api: ApiClient,
  masjidId: string,
  v: number,
  aud: 'brothers' | 'sisters',
  type: ItemType | undefined,
  cursor: string,
) =>
  queryOptions({
    queryKey: [...queryKeys.feed(masjidId, v, aud, type), cursor] as const,
    queryFn: ({ signal }) => api.feed(masjidId, { v, aud, cursor, ...(type ? { type } : {}) }, signal),
    staleTime: Number.POSITIVE_INFINITY,
  });

export const configQuery = (api: ApiClient) =>
  queryOptions({ queryKey: queryKeys.config(), queryFn: ({ signal }) => api.config(signal), staleTime: 60_000 });

export const templatesQuery = (api: ApiClient) =>
  queryOptions({
    queryKey: queryKeys.templates(),
    queryFn: ({ signal }) => api.templates(signal),
    staleTime: 60 * 60_000,
  });

/**
 * Removes cached bundle, feed, Ruqyah and needy-people queries of versions older than `versions` says (content-version → targeted
 * invalidation: newer versions are fetched by the screens, the old ones only waste the persisted cache).
 *
 * @returns how many queries were removed.
 */
export function pruneStaleVersions(client: QueryClient, versions: MasjidVersions): number {
  let removed = 0;
  const advanced = new Set<string>();
  for (const query of client.getQueryCache().getAll()) {
    const [root, masjidId, v] = query.queryKey;
    if (
      (root !== 'bundle' && root !== 'feed' && root !== 'ruqyah' && root !== 'needy') ||
      typeof masjidId !== 'string' ||
      typeof v !== 'number'
    )
      continue;
    const current = versions[masjidId]?.v;
    // An old bundle stays until the current one has loaded: it is the screen's placeholder (`previousBundle`).
    const placeholder =
      root === 'bundle' && current !== undefined && !client.getQueryData(queryKeys.bundle(masjidId, current));
    if (current !== undefined && v < current) advanced.add(masjidId);
    if (current !== undefined && v < current && !placeholder) {
      client.removeQueries({ queryKey: query.queryKey, exact: true });
      removed += 1;
    }
  }
  // A masjid's content moved on: its opened posts may have been edited, deleted or removed by moderation (T8.2) —
  // check them again now instead of after their 5 minutes (a removed post must vanish after the next poll).
  if (advanced.size > 0) {
    void client.invalidateQueries({
      predicate: (query) => {
        if (query.queryKey[0] !== 'item') return false;
        const data: unknown = query.state.data;
        const masjidId =
          typeof data === 'object' && data !== null && 'item' in data
            ? (data as { item?: { masjidId?: unknown } }).item?.masjidId // ItemDetail (parsed by the client)
            : undefined;
        return typeof masjidId === 'string' && advanced.has(masjidId);
      },
    });
  }
  return removed;
}
