// One item for the detail screens (07 A7–A9, `/items/:publicId`): taken from the cached feed pages when the item was
// listed (instant, offline), else fetched (`GET /items/:publicId` — links, pushes). The item query is persisted, so an
// item opened once (or saved) opens again offline.
import type { FeedItem, FeedPage, ItemDetail, MasjidBundle, MasjidSummary } from '@mc/shared/contracts/public';
import { ProblemError } from '@mc/shared/http';
import { type QueryClient, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ApiClient } from '../../../lib/api/client.ts';
import { queryKeys } from '../../../lib/api/keys.ts';
import { useAppData, useDeviceSelector } from '../../../lib/data.tsx';
import { useHomeData } from '../../home/hooks/useHomeData.ts';

/** An item can be removed by its masjid or moderation: check again after a few minutes. */
const ITEM_STALE_MS = 5 * 60_000;

export const itemQuery = (api: ApiClient, publicId: string, aud: 'brothers' | 'sisters') =>
  queryOptions({
    queryKey: queryKeys.item(publicId, aud),
    queryFn: ({ signal }) => api.item(publicId, { aud }, signal),
    staleTime: ITEM_STALE_MS,
    // A missing item stays missing; network trouble is retried by the client already.
    retry: false,
  });

/** The item from any cached feed page (newest version first is not needed: a public id is one item). */
export function findCachedItem(client: QueryClient, publicId: string): FeedItem | undefined {
  for (const [, page] of client.getQueriesData<FeedPage>({ queryKey: ['feed'] })) {
    const found = page?.items.find((entry) => entry.publicId === publicId);
    if (found) return found;
  }
  return undefined;
}

/** A masjid opened from a link (not followed) has its own cached bundle (Masjid Detail loaded it). */
function cachedProfile(client: QueryClient, masjidId: string): MasjidSummary | null {
  for (const [, bundle] of client.getQueriesData<MasjidBundle>({ queryKey: queryKeys.bundles(masjidId) })) {
    if (bundle?.status === 'active') return bundle.masjid;
  }
  return null;
}

export type ItemState =
  | { readonly state: 'loading' }
  | { readonly state: 'gone' }
  | { readonly state: 'failed'; readonly retry: () => void }
  | { readonly state: 'ready'; readonly item: FeedItem; readonly masjid: MasjidSummary | null };

export function useItem(publicId: string): ItemState {
  const { api } = useAppData();
  const queryClient = useQueryClient();
  const audience = useDeviceSelector((state) => state.audiencePref) ?? 'brothers';
  const home = useHomeData();
  const cached = findCachedItem(queryClient, publicId);
  const query = useQuery({ ...itemQuery(api, publicId, audience), enabled: cached === undefined });

  const item: FeedItem | undefined = cached ?? query.data?.item;
  if (item) {
    const followed = home.masjids.find((entry) => entry.id === item.masjidId);
    const masjid: MasjidSummary | null =
      followed?.state === 'active'
        ? followed.bundle.masjid
        : (query.data?.masjid ?? cachedProfile(queryClient, item.masjidId));
    return { state: 'ready', item, masjid };
  }
  if (query.error instanceof ProblemError && query.error.status === 404) return { state: 'gone' };
  if (query.isError) {
    return {
      state: 'failed',
      retry: () => {
        void query.refetch();
      },
    };
  }
  return { state: 'loading' };
}

/** Puts an item into the persisted item cache (Save keeps it readable offline — Settings → Saved, T2.12). */
export function primeItem(client: QueryClient, aud: 'brothers' | 'sisters', detail: ItemDetail): void {
  client.setQueryData(queryKeys.item(detail.item.publicId, aud), detail);
}
