// Query definitions (T2.3): versions polling and the versioned resources it targets (01 §5.2). The versions endpoint
// is polled on focus and every 60 s while the page is visible (and after a push from Phase 4); each masjid's bundle
// and feed queries carry `v`, so a changed version makes screens fetch exactly the changed masjids. Queries of older
// versions are pruned so the persisted cache does not grow.
import type { ItemType, MasjidVersions } from '@mc/shared/contracts/public';
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

/** One feed page (the first page is what Home and Updates show offline). */
export const feedQuery = (api: ApiClient, masjidId: string, v: number, aud: 'brothers' | 'sisters', type?: ItemType) =>
  queryOptions({
    queryKey: queryKeys.feed(masjidId, v, aud, type),
    queryFn: ({ signal }) => api.feed(masjidId, { v, aud, ...(type ? { type } : {}) }, signal),
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
 * Removes cached bundle and feed queries of versions older than `versions` says (content-version → targeted
 * invalidation: newer versions are fetched by the screens, the old ones only waste the persisted cache).
 *
 * @returns how many queries were removed.
 */
export function pruneStaleVersions(client: QueryClient, versions: MasjidVersions): number {
  let removed = 0;
  for (const query of client.getQueryCache().getAll()) {
    const [root, masjidId, v] = query.queryKey;
    if ((root !== 'bundle' && root !== 'feed') || typeof masjidId !== 'string' || typeof v !== 'number') continue;
    const current = versions[masjidId]?.v;
    if (current !== undefined && v < current) {
      client.removeQueries({ queryKey: query.queryKey, exact: true });
      removed += 1;
    }
  }
  return removed;
}
