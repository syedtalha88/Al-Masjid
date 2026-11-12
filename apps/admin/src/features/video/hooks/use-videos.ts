// B10 data (PHASE_06 T6.2): the masjid's bayans, the link preview, and the writes. Every write refreshes the list (and
// the Home numbers, which count published items).
import type { VideoPatch } from '@mc/shared/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { masjidApi, masjidKeys } from '../../home/api/masjid-api.ts';

export function useVideos(masjidId: string | undefined) {
  const id = masjidId ?? '';
  return useQuery({
    queryKey: masjidKeys.videos(id),
    queryFn: ({ signal }) => masjidApi.videos(id, signal),
    enabled: masjidId !== undefined,
  });
}

export function useVideoPreview(masjidId: string | undefined) {
  const id = masjidId ?? '';
  return useMutation({ mutationFn: (url: string) => masjidApi.previewVideo(id, url) });
}

export function useVideoWrites(masjidId: string | undefined) {
  const queryClient = useQueryClient();
  const id = masjidId ?? '';
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: masjidKeys.videos(id) });
    await queryClient.invalidateQueries({ queryKey: masjidKeys.stats(id) });
  };
  const edit = useMutation({
    mutationFn: ({ videoId, updatedAt, body }: { videoId: string; updatedAt: string; body: VideoPatch }) =>
      masjidApi.editVideo(id, videoId, updatedAt, body),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (videoId: string) => masjidApi.deleteItem(id, videoId),
    onSuccess: refresh,
  });
  return { edit, remove, refresh };
}
