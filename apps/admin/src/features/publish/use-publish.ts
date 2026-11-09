// The publish moment shared by B5–B7 (07 B5 step 3): today's notifications and the publish call. A publish refreshes
// the masjid's queries (Home's stats, the quota pill, the hadith/ayah suggestion).
import type { ItemEditBody, ItemPublished } from '@mc/shared/contracts';
import { ProblemError } from '@mc/shared/http';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { masjidApi, masjidKeys } from '../home/api/masjid-api.ts';

/** Today's notifications (the Publish bar's quota line). */
export function useQuota(masjidId: string | undefined) {
  const id = masjidId ?? '';
  return useQuery({
    queryKey: masjidKeys.quota(id),
    queryFn: ({ signal }) => masjidApi.quota(id, signal),
    enabled: masjidId !== undefined,
    // "Will notify N people" is the last thing read before notifying: read it again when the Publish bar appears,
    // not Home's answer from up to a minute ago (followers turn notifications on and off meanwhile). The cached
    // value shows until the new one arrives.
    refetchOnMount: 'always',
  });
}

/** Publishing an item with `send`; `quotaExceeded` when today's notifications ran out meanwhile. */
export function usePublishItem<Body>(
  masjidId: string | undefined,
  send: (masjidId: string, body: Body) => Promise<ItemPublished>,
) {
  const queryClient = useQueryClient();
  const id = masjidId ?? '';
  const publish = useMutation({
    mutationFn: (body: Body) => send(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: masjidKeys.all(id) }),
  });
  const quotaExceeded = publish.error instanceof ProblemError && publish.error.problem.code === 'NOTIFY_QUOTA_EXCEEDED';
  return { publish, quotaExceeded };
}

/** A draft that edits a post (B12 → a creation flow, T3.9): the post and the `updatedAt` it was opened at (If-Match). */
export interface ItemEditing {
  readonly itemId: string;
  readonly updatedAt: string;
}

/** Saving an edit; `stale` when someone saved the post after it was opened (412). */
export function useEditItem(masjidId: string | undefined) {
  const queryClient = useQueryClient();
  const id = masjidId ?? '';
  const save = useMutation({
    mutationFn: ({ editing, body }: { readonly editing: ItemEditing; readonly body: ItemEditBody }) =>
      masjidApi.editItem(id, editing.itemId, editing.updatedAt, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: masjidKeys.all(id) }),
  });
  const stale = save.error instanceof ProblemError && save.error.problem.code === 'PRECONDITION_FAILED';
  return { save, stale };
}
