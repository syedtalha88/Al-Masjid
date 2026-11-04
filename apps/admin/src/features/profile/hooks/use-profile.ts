// B13 data (07 B13, PHASE_03 T3.10): the masjid profile, the Hijri adjustment, a new photo and "Request change". A
// change puts the answered profile in the cache and refreshes the masjid's other queries.
import type { AdminMasjidProfile } from '@mc/shared/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { masjidApi, masjidKeys } from '../../home/api/masjid-api.ts';

/** The masjid as B13 shows it. */
export function useProfile(masjidId: string | undefined) {
  const id = masjidId ?? '';
  return useQuery({
    queryKey: masjidKeys.profile(id),
    queryFn: ({ signal }) => masjidApi.profile(id, signal),
    enabled: masjidId !== undefined,
  });
}

/** Writes that answer the new profile: it replaces the cached one. */
function useProfileWrite<Input>(
  masjidId: string | undefined,
  send: (id: string, input: Input) => Promise<AdminMasjidProfile>,
) {
  const queryClient = useQueryClient();
  const id = masjidId ?? '';
  return useMutation({
    mutationFn: (input: Input) => send(id, input),
    onSuccess: async (profile) => {
      queryClient.setQueryData(masjidKeys.profile(id), profile);
      await queryClient.invalidateQueries({ queryKey: masjidKeys.all(id) });
    },
  });
}

/** The Hijri adjustment (−2…+2; `null` = the app's). */
export const useHijriOffset = (masjidId: string | undefined) =>
  useProfileWrite(masjidId, (id, offset: number | null) => masjidApi.setHijriOffset(id, offset));

/** A new masjid photo. */
export const useMasjidPhoto = (masjidId: string | undefined) =>
  useProfileWrite(masjidId, (id, file: Blob) => masjidApi.uploadMasjidPhoto(id, file));

/** "Request change": a note for the Super Admin. */
export function useChangeRequest(masjidId: string | undefined) {
  const id = masjidId ?? '';
  return useMutation({ mutationFn: (note: string) => masjidApi.requestChange(id, note) });
}
