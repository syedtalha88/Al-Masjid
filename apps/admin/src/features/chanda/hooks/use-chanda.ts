// B9 data (PHASE_05 T5.5): the masjid's chanda settings and weeks, and the writes — save a week, show / hide, week start.
// Every write refreshes the list (and the Home numbers and today's notifications).
import type { ChandaSettings, ChandaWeekSave } from '@mc/shared/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { masjidApi, masjidKeys } from '../../home/api/masjid-api.ts';

export function useChanda(masjidId: string | undefined) {
  const id = masjidId ?? '';
  return useQuery({
    queryKey: masjidKeys.chanda(id),
    queryFn: ({ signal }) => masjidApi.chanda(id, signal),
    enabled: masjidId !== undefined,
  });
}

export function useChandaWrites(masjidId: string | undefined) {
  const queryClient = useQueryClient();
  const id = masjidId ?? '';
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: masjidKeys.chanda(id) });
    await queryClient.invalidateQueries({ queryKey: masjidKeys.stats(id) });
    await queryClient.invalidateQueries({ queryKey: masjidKeys.quota(id) });
  };
  const save = useMutation({
    mutationFn: ({ weekStart, body }: { readonly weekStart: string; readonly body: ChandaWeekSave }) =>
      masjidApi.saveChandaWeek(id, weekStart, body),
    onSuccess: refresh,
  });
  const settings = useMutation({
    mutationFn: (body: ChandaSettings) => masjidApi.chandaSettings(id, body),
    onSuccess: refresh,
  });
  return { save, settings };
}
