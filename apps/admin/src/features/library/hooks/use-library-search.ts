// The verified Content Library as admins pick from it (07 B6 "Choose another", B7 "Attach dua", B16 "Add dhikr" —
// PHASE_03 T3.7, T3.8, T3.14): entries of a kind — search words, a topic tag, a dua category — page by page.
import { useInfiniteQuery } from '@tanstack/react-query';

import { masjidApi, masjidKeys } from '../../home/api/masjid-api.ts';

export interface LibrarySearch {
  readonly kind: 'hadith' | 'ayah' | 'dua' | 'dhikr';
  readonly q: string;
  readonly tag: string;
  readonly category?: 'illness' | 'inteqal' | 'other' | undefined;
}

/** Verified entries matching `filter`, page by page; idle while `enabled` is false. */
export function useLibrarySearch(masjidId: string | undefined, filter: LibrarySearch, enabled: boolean) {
  const id = masjidId ?? '';
  return useInfiniteQuery({
    queryKey: masjidKeys.library(id, filter.kind, filter.q, filter.tag, filter.category ?? ''),
    queryFn: ({ pageParam, signal }) =>
      masjidApi.library(
        id,
        {
          kind: filter.kind,
          ...(filter.q ? { q: filter.q } : {}),
          ...(filter.tag ? { tag: filter.tag } : {}),
          ...(filter.category ? { category: filter.category } : {}),
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
