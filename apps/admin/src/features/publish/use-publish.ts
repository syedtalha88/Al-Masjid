// The publish moment shared by B5–B7 (07 B5 step 3): today's notifications and the publish call. A publish refreshes
// the masjid's queries (Home's stats, the quota pill, the hadith/ayah suggestion).
import type { ItemPublished } from '@mc/shared/contracts';
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
