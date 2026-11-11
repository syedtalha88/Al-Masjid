// B19 data (07 B19, PHASE_05 T5.8): the masjid's needy people and the writes — add / replace, "Update received", close,
// remove — plus the one read of a person's private phone / note (the server audits each view; it is never cached).
// Every write refreshes the list.
import type { BeneficiarySave } from '@mc/shared/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { masjidApi, masjidKeys } from '../../home/api/masjid-api.ts';

export function useNeedy(masjidId: string | undefined) {
  const id = masjidId ?? '';
  return useQuery({
    queryKey: masjidKeys.beneficiaries(id),
    queryFn: ({ signal }) => masjidApi.beneficiaries(id, signal),
    enabled: masjidId !== undefined,
  });
}

export function useNeedyWrites(masjidId: string | undefined) {
  const queryClient = useQueryClient();
  const id = masjidId ?? '';
  const refresh = () => queryClient.invalidateQueries({ queryKey: masjidKeys.beneficiaries(id) });
  const save = useMutation({
    mutationFn: ({ personId, body }: { readonly personId: string | null; readonly body: BeneficiarySave }) =>
      masjidApi.saveBeneficiary(id, personId, body),
    onSuccess: refresh,
  });
  const received = useMutation({
    mutationFn: ({ personId, receivedPaise }: { readonly personId: string; readonly receivedPaise: number }) =>
      masjidApi.beneficiaryReceived(id, personId, receivedPaise),
    onSuccess: refresh,
  });
  const end = useMutation({
    mutationFn: ({ personId, as }: { readonly personId: string; readonly as: 'closed' | 'deleted' }) =>
      as === 'closed' ? masjidApi.closeBeneficiary(id, personId) : masjidApi.deleteBeneficiary(id, personId),
    onSuccess: refresh,
  });
  /** A mutation, not a query: each call is an audited view and its result lives only in the open form. */
  const showPrivate = useMutation({
    mutationFn: (personId: string) => masjidApi.beneficiaryPrivate(id, personId),
  });
  return { save, received, end, showPrivate };
}
