// B15 data (07 B15, PHASE_03 T3.15): the masjid's Ruqyah entries and the writes — add, replace, delete, order. Every
// write refreshes the list; an order answers with the new list, which replaces the cached one.
import type { RuqyahSave } from '@mc/shared/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { masjidApi, masjidKeys } from '../../home/api/masjid-api.ts';

export function useRuqyah(masjidId: string | undefined) {
  const id = masjidId ?? '';
  return useQuery({
    queryKey: masjidKeys.ruqyah(id),
    queryFn: ({ signal }) => masjidApi.ruqyah(id, signal),
    enabled: masjidId !== undefined,
  });
}

export function useRuqyahWrites(masjidId: string | undefined) {
  const queryClient = useQueryClient();
  const id = masjidId ?? '';
  const refresh = () => queryClient.invalidateQueries({ queryKey: masjidKeys.ruqyah(id) });
  const save = useMutation({
    mutationFn: ({ entryId, body }: { readonly entryId: string | null; readonly body: RuqyahSave }) =>
      entryId === null ? masjidApi.addRuqyah(id, body) : masjidApi.updateRuqyah(id, entryId, body),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (entryId: string) => masjidApi.deleteRuqyah(id, entryId),
    onSuccess: refresh,
  });
  const order = useMutation({
    mutationFn: (ids: readonly string[]) => masjidApi.orderRuqyah(id, ids),
    onSuccess: (list) => {
      queryClient.setQueryData(masjidKeys.ruqyah(id), list);
    },
    // A conflict (someone changed the list meanwhile) shows the server's list again.
    onError: refresh,
  });
  return { save, remove, order };
}
