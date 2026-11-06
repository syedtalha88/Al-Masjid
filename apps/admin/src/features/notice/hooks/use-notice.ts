// B5 data (07 B5, PHASE_03 T3.6): the masjid's pickable templates and the photo upload (the publish itself is
// `features/publish`).
import { useMutation, useQuery } from '@tanstack/react-query';

import { masjidApi, masjidKeys } from '../../home/api/masjid-api.ts';

/** Templates an admin may pick (active, not system). */
export function useNoticeTemplates(masjidId: string | undefined) {
  const id = masjidId ?? '';
  return useQuery({
    queryKey: masjidKeys.templates(id),
    queryFn: ({ signal }) => masjidApi.templates(id, signal),
    enabled: masjidId !== undefined,
    staleTime: 5 * 60 * 1000,
  });
}

/** Uploading a notice photo. */
export function usePhotoUpload(masjidId: string | undefined) {
  const id = masjidId ?? '';
  return useMutation({ mutationFn: (file: Blob) => masjidApi.uploadImage(id, file) });
}
