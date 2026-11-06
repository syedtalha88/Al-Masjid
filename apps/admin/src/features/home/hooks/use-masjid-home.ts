// The Admin Home's data for the selected masjid (07 B3): followers / week stats, today's push quota, and the schedule
// the today strip resolves on the phone. Each part loads on its own; a failed one hides its own piece only.
import { useQuery } from '@tanstack/react-query';

import { masjidApi, masjidKeys } from '../api/masjid-api.ts';

const MINUTE = 60_000;

export function useMasjidHome(masjidId: string | undefined) {
  const id = masjidId ?? '';
  const enabled = masjidId !== undefined;
  const stats = useQuery({
    queryKey: masjidKeys.stats(id),
    queryFn: ({ signal }) => masjidApi.stats(id, signal),
    enabled,
    staleTime: 5 * MINUTE,
  });
  const quota = useQuery({
    queryKey: masjidKeys.quota(id),
    queryFn: ({ signal }) => masjidApi.quota(id, signal),
    enabled,
    staleTime: MINUTE,
  });
  const schedule = useQuery({
    queryKey: masjidKeys.schedule(id),
    queryFn: ({ signal }) => masjidApi.schedule(id, signal),
    enabled,
    staleTime: 10 * MINUTE,
  });
  return { stats, quota, schedule };
}
