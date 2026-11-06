// B17 data (07 B17, PHASE_03 T3.16): the masjid's Ilm contacts and the writes — add, replace, delete. Every write
// refreshes the list.
import type { ContactSave } from '@mc/shared/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { masjidApi, masjidKeys } from '../../home/api/masjid-api.ts';

export function useContacts(masjidId: string | undefined) {
  const id = masjidId ?? '';
  return useQuery({
    queryKey: masjidKeys.contacts(id),
    queryFn: ({ signal }) => masjidApi.contacts(id, signal),
    enabled: masjidId !== undefined,
  });
}

export function useContactWrites(masjidId: string | undefined) {
  const queryClient = useQueryClient();
  const id = masjidId ?? '';
  const refresh = () => queryClient.invalidateQueries({ queryKey: masjidKeys.contacts(id) });
  const save = useMutation({
    mutationFn: ({ contactId, body }: { readonly contactId: string | null; readonly body: ContactSave }) =>
      contactId === null ? masjidApi.addContact(id, body) : masjidApi.updateContact(id, contactId, body),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (contactId: string) => masjidApi.deleteContact(id, contactId),
    onSuccess: refresh,
  });
  return { save, remove };
}
