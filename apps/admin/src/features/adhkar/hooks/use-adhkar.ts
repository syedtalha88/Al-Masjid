// B16 data (07 B16, PHASE_03 T3.14): the masjid's "Adhkar after salah" set and saving it — the answered set replaces
// the cached one.
import type { AdhkarPut } from '@mc/shared/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { masjidApi, masjidKeys } from '../../home/api/masjid-api.ts';

/** On/off and the chosen dhikr, in order. */
export function useAdhkar(masjidId: string | undefined) {
  const id = masjidId ?? '';
  return useQuery({
    queryKey: masjidKeys.adhkar(id),
    queryFn: ({ signal }) => masjidApi.adhkar(id, signal),
    enabled: masjidId !== undefined,
  });
}

/** `PUT /adhkar` — the whole set. */
export function useSaveAdhkar(masjidId: string | undefined) {
  const queryClient = useQueryClient();
  const id = masjidId ?? '';
  return useMutation({
    mutationFn: (body: AdhkarPut) => masjidApi.saveAdhkar(id, body),
    onSuccess: (saved) => {
      queryClient.setQueryData(masjidKeys.adhkar(id), saved);
    },
  });
}
