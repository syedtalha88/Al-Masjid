// B5 data (07 B5, PHASE_03 T3.6): the masjid's pickable templates, the photo upload and the publish. A publish
// refreshes the masjid's queries (Home's stats, the quota pill).
import type { AnnouncementPublish } from '@mc/shared/contracts';
import { ProblemError } from '@mc/shared/http';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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

/** Today's notifications (the Publish bar's quota line). */
export function useQuota(masjidId: string | undefined) {
  const id = masjidId ?? '';
  return useQuery({
    queryKey: masjidKeys.quota(id),
    queryFn: ({ signal }) => masjidApi.quota(id, signal),
    enabled: masjidId !== undefined,
  });
}

/** Uploading a notice photo. */
export function usePhotoUpload(masjidId: string | undefined) {
  const id = masjidId ?? '';
  return useMutation({ mutationFn: (file: Blob) => masjidApi.uploadImage(id, file) });
}

/** Publishing the notice; `quotaExceeded` when today's notifications ran out meanwhile. */
export function usePublishNotice(masjidId: string | undefined) {
  const queryClient = useQueryClient();
  const id = masjidId ?? '';
  const publish = useMutation({
    mutationFn: (body: AnnouncementPublish) => masjidApi.publishAnnouncement(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: masjidKeys.all(id) }),
  });
  const quotaExceeded = publish.error instanceof ProblemError && publish.error.problem.code === 'NOTIFY_QUOTA_EXCEEDED';
  return { publish, quotaExceeded };
}
