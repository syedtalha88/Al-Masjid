// B11 data (07 B11, PHASE_03 T3.3): the masjid's special dates and Ramadan settings, and the writes. Every write
// refreshes the masjid's queries (the list, the quota pill after a notifying save, Home's stats).
import type { RamadanSave, SpecialDateSave } from '@mc/shared/contracts';
import { ProblemError } from '@mc/shared/http';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { masjidApi, masjidKeys } from '../../home/api/masjid-api.ts';

/** The masjid's special dates (from 30 days ago). */
export function useSpecialDates(masjidId: string | undefined) {
  const id = masjidId ?? '';
  return useQuery({
    queryKey: masjidKeys.special(id),
    queryFn: ({ signal }) => masjidApi.specialDates(id, signal),
    enabled: masjidId !== undefined,
  });
}

/** Saving (`id` null = new) and deleting a special date. */
export function useSpecialDateWrites(masjidId: string | undefined) {
  const queryClient = useQueryClient();
  const id = masjidId ?? '';
  const refresh = () => queryClient.invalidateQueries({ queryKey: masjidKeys.all(id) });
  const save = useMutation({
    mutationFn: ({ entryId, body }: { readonly entryId: string | null; readonly body: SpecialDateSave }) =>
      masjidApi.saveSpecialDate(id, entryId, body),
    onSuccess: refresh,
  });
  // No refresh here: the deleted entry's screen leaves first (`refresh` after it), or the refetch would replace it
  // with "removed" while the delete is still settling.
  const remove = useMutation({ mutationFn: (entryId: string) => masjidApi.deleteSpecialDate(id, entryId) });
  const quotaExceeded = save.error instanceof ProblemError && save.error.problem.code === 'NOTIFY_QUOTA_EXCEEDED';
  return { save, remove, refresh, quotaExceeded };
}

/** Ramadan mode and precautions, and saving them. */
export function useRamadan(masjidId: string | undefined) {
  const queryClient = useQueryClient();
  const id = masjidId ?? '';
  const ramadan = useQuery({
    queryKey: masjidKeys.ramadan(id),
    queryFn: ({ signal }) => masjidApi.ramadan(id, signal),
    enabled: masjidId !== undefined,
  });
  const save = useMutation({
    mutationFn: (body: RamadanSave) => masjidApi.saveRamadan(id, body),
    onSuccess: (saved) => {
      queryClient.setQueryData(masjidKeys.ramadan(id), saved);
    },
  });
  return { ramadan, save };
}
