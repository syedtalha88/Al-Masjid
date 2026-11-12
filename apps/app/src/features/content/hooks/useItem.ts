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

/**
 * The item from the cached feed pages, taken from the newest content version that lists it: a campaign's amount and
 * status change while its public id stays (older versions linger until the next versions poll prunes them).
 */
export function findCachedItem(client: QueryClient, publicId: string): FeedItem | undefined {
  let best: { readonly v: number; readonly item: FeedItem } | undefined;
  for (const [key, page] of client.getQueriesData<FeedPage>({ queryKey: ['feed'] })) {
    const found = page?.items.find((entry) => entry.publicId === publicId);
    const v = typeof key[2] === 'number' ? key[2] : 0;
    if (found && (best === undefined || v > best.v)) best = { v, item: found };
  }
  return best?.item;
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
  /** `video`: the phone had it as a bayan — it may still be on the masjid's YouTube channel (F74). */
  | { readonly state: 'gone'; readonly video?: boolean }
  | { readonly state: 'failed'; readonly retry: () => void }
  | { readonly state: 'ready'; readonly item: FeedItem; readonly masjid: MasjidSummary | null };

export function useItem(publicId: string): ItemState {
  const { api } = useAppData();
  const queryClient = useQueryClient();
  const audience = useDeviceSelector((state) => state.audiencePref) ?? 'brothers';
  const home = useHomeData();
  const cached = findCachedItem(queryClient, publicId);
  const query = useQuery({ ...itemQuery(api, publicId, audience), enabled: cached === undefined });

  // The server says it is gone (deleted, or removed by moderation — T8.2): never show the copy kept from before.
  if (query.error instanceof ProblemError && query.error.status === 404) {
    // The copy kept from before says what it was: a removed bayan may still be on YouTube (F74, 07 A12).
    const before = query.data?.item ?? cached;
    return before?.type === 'video' ? { state: 'gone', video: true } : { state: 'gone' };
  }
  const item: FeedItem | undefined = cached ?? query.data?.item;
  if (item) {
    const followed = home.masjids.find((entry) => entry.id === item.masjidId);
    const masjid: MasjidSummary | null =
      followed?.state === 'active'
        ? followed.bundle.masjid
        : (query.data?.masjid ?? cachedProfile(queryClient, item.masjidId));
    return { state: 'ready', item, masjid };
  }
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
