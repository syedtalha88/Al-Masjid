// The masjid's notification history (07 B3 → quota pill, PHASE_04 T4.5): jobs page by page, newest first. A job that
// is still waiting or sending is refreshed every few seconds while the screen is open.
import { useInfiniteQuery } from '@tanstack/react-query';

import { masjidApi, masjidKeys } from '../home/api/masjid-api.ts';

const LIVE_REFRESH_MS = 5000;

export function useNotificationJobs(masjidId: string | undefined) {
  const id = masjidId ?? '';
  return useInfiniteQuery({
    queryKey: masjidKeys.notifications(id),
    queryFn: ({ pageParam, signal }) => masjidApi.notificationJobs(id, pageParam || undefined, signal),
    initialPageParam: '',
    getNextPageParam: (page) => page.next ?? undefined,
    enabled: masjidId !== undefined,
    refetchInterval: (query) =>
      query.state.data?.pages[0]?.jobs.some((job) => job.status === 'pending' || job.status === 'running')
        ? LIVE_REFRESH_MS
        : false,
  });
}
