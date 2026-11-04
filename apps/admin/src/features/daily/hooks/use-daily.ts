// B6 data (07 B6, PHASE_03 T3.7): today's suggestion per kind (with "already one today") and the "Choose another"
// search over the verified library. A publish refreshes both (`features/publish` invalidates the masjid's queries).
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { masjidApi, masjidKeys } from '../../home/api/masjid-api.ts';
import type { DailyKind } from '../lib/daily.ts';

/** Today's suggestion of `kind` — the same all day for the masjid. */
export function useSuggestion(masjidId: string | undefined, kind: DailyKind) {
  const id = masjidId ?? '';
  return useQuery({
    queryKey: masjidKeys.suggestion(id, kind),
    queryFn: ({ signal }) => masjidApi.suggestion(id, kind, signal),
    enabled: masjidId !== undefined,
  });
}

/** Verified entries of `kind` matching the search words and topic, page by page; idle while `enabled` is false. */
export function useLibrarySearch(
  masjidId: string | undefined,
  filter: { readonly kind: DailyKind; readonly q: string; readonly tag: string },
  enabled: boolean,
) {
  const id = masjidId ?? '';
  return useInfiniteQuery({
    queryKey: masjidKeys.library(id, filter.kind, filter.q, filter.tag),
    queryFn: ({ pageParam, signal }) =>
      masjidApi.library(
        id,
        {
          kind: filter.kind,
          ...(filter.q ? { q: filter.q } : {}),
          ...(filter.tag ? { tag: filter.tag } : {}),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        signal,
      ),
    initialPageParam: '',
    getNextPageParam: (page) => page.next,
    enabled: enabled && masjidId !== undefined,
    staleTime: 5 * 60 * 1000,
  });
}
