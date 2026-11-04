// B12 data (07 B12, PHASE_03 T3.9): the masjid's posts page by page (per type chip) and deleting one. A delete refreshes
// the masjid's queries (the list, Home's stats).
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { masjidApi, masjidKeys } from '../../home/api/masjid-api.ts';
import type { PostType } from '../lib/posts.ts';

/** The posts of `type` (`all` = every type), newest first. */
export function usePosts(masjidId: string | undefined, type: PostType) {
  const id = masjidId ?? '';
  return useInfiniteQuery({
    queryKey: masjidKeys.items(id, type),
    queryFn: ({ pageParam, signal }) =>
      masjidApi.items(id, { ...(type === 'all' ? {} : { type }), ...(pageParam ? { cursor: pageParam } : {}) }, signal),
    initialPageParam: '',
    getNextPageParam: (page) => page.next ?? undefined,
    enabled: masjidId !== undefined,
  });
}

/** Deleting a post (after the confirm dialog). */
export function useDeletePost(masjidId: string | undefined) {
  const queryClient = useQueryClient();
  const id = masjidId ?? '';
  return useMutation({
    mutationFn: (itemId: string) => masjidApi.deleteItem(id, itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: masjidKeys.all(id) }),
  });
}
