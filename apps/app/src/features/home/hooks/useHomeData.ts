// Home's data (07 A2, 01 §5.2): followed masjids in the user's order → their content versions → the immutable bundle
// and first feed page of each version (persisted, so Home renders offline from cache). Pull-to-refresh re-checks the
// versions; changed masjids load their new bundle/feed by key.
import type { ActiveMasjidBundle, FeedItem, FeedPage, MasjidBundle } from '@mc/shared/contracts/public';
import { type FetchStatus, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { bundleQuery, feedQuery, templatesQuery } from '../../../lib/api/queries.ts';
import { useAppData, useDeviceSelector, useFollowedIds } from '../../../lib/data.tsx';
import { useMasjidVersions } from '../../../lib/versions.ts';
import { mergeRecent } from '../lib/home-view.ts';

/** Home shows the 5 newest items across followed masjids (07 A2). */
export const RECENT_LIMIT = 5;

/** The parts of each bundle query Home reads; a new array only when one of them changed (see `combine` below). */
const pickBundles = (results: readonly { data?: MasjidBundle | undefined; isError: boolean }[]) =>
  results.map((result) => ({ data: result.data, isError: result.isError }));

/** The parts of each feed query Home reads. */
const pickFeeds = (results: readonly { data?: FeedPage | undefined; isPending: boolean; fetchStatus: FetchStatus }[]) =>
  results.map((result) => ({ data: result.data, isPending: result.isPending, fetchStatus: result.fetchStatus }));

export type HomeMasjid =
  | { readonly id: string; readonly state: 'loading' | 'failed' }
  | { readonly id: string; readonly state: 'suspended' }
  | { readonly id: string; readonly state: 'active'; readonly bundle: ActiveMasjidBundle };

export interface HomeData {
  /** Followed masjids in order; masjids the server no longer lists (removed) are left out. */
  readonly masjids: readonly HomeMasjid[];
  /** Nothing followed. */
  readonly empty: boolean;
  /** No versions could be loaded at all (offline on a first open) — the screen offers a retry. */
  readonly failed: boolean;
  readonly recent: readonly FeedItem[];
  /** First feed page per masjid (My Masjids' "N new updates"). */
  readonly itemsByMasjid: ReadonlyMap<string, readonly FeedItem[]>;
  /** Feeds still loading (first time). */
  readonly recentLoading: boolean;
  readonly refresh: () => Promise<void>;
}

export function useHomeData(): HomeData {
  const { api } = useAppData();
  const queryClient = useQueryClient();
  const ids = useFollowedIds();
  const audiencePref = useDeviceSelector((state) => state.audiencePref);
  const { versions, failed, refresh } = useMasjidVersions();
  const audience = audiencePref ?? 'brothers';
  useQuery(templatesQuery(api)); // template titles for notices (cached for an hour)

  // `combine` (module-level, stable): without it useQueries hands out a new array on every render, so every memo below
  // — and the memoised rows of Home / My Masjids — re-ran on any state change, prayer times included (F46 trace).
  const bundles = useQueries({
    queries: ids.map((id) => {
      const v = versions?.[id]?.v;
      return { ...bundleQuery(api, id, v ?? 0), enabled: v !== undefined };
    }),
    combine: pickBundles,
  });
  const feeds = useQueries({
    queries: ids.map((id) => {
      const entry = versions?.[id];
      return { ...feedQuery(api, id, entry?.v ?? 0, audience), enabled: entry?.status === 'active' };
    }),
    combine: pickFeeds,
  });

  const masjids = useMemo(
    () =>
      ids.flatMap((id, index): HomeMasjid[] => {
        if (versions && !(id in versions)) return []; // removed / not listed
        const query = bundles[index];
        const data = query?.data;
        if (data?.status === 'active') return [{ id, state: 'active', bundle: data }];
        if (data?.status === 'suspended' || versions?.[id]?.status === 'suspended') return [{ id, state: 'suspended' }];
        return [{ id, state: query?.isError ? 'failed' : 'loading' }];
      }),
    [ids, versions, bundles],
  );

  const itemsByMasjid = useMemo(
    () => new Map(ids.map((id, index) => [id, feeds[index]?.data?.items ?? []] as const)),
    [ids, feeds],
  );

  const recent = useMemo(
    () =>
      mergeRecent(
        feeds.map((query) => query.data?.items ?? []),
        RECENT_LIMIT,
      ),
    [feeds],
  );

  const refreshAll = useCallback(async () => {
    await refresh();
    // New versions mean new keys: wait for those loads (and retry failed ones) before the spinner stops.
    await queryClient.refetchQueries({ type: 'active', predicate: (query) => query.state.status === 'error' });
    await waitIdle(queryClient);
  }, [refresh, queryClient]);

  return {
    masjids,
    empty: ids.length === 0,
    failed: failed && ids.length > 0,
    recent,
    itemsByMasjid,
    recentLoading: feeds.some((query) => query.isPending && query.fetchStatus === 'fetching'),
    refresh: refreshAll,
  };
}

/** Resolves once no query is fetching (or after 10 s — a slow network must not leave the spinner forever). */
function waitIdle(client: ReturnType<typeof useQueryClient>): Promise<void> {
  return new Promise((resolve) => {
    if (client.isFetching() === 0) {
      resolve();
      return;
    }
    const timer = setTimeout(done, 10_000);
    const unsubscribe = client.getQueryCache().subscribe(() => {
      if (client.isFetching() === 0) done();
    });
    function done() {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    }
  });
}
