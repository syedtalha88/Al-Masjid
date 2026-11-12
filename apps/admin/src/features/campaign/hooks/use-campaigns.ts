// B8 data (PHASE_05 T5.3): the masjid's donation drives and the writes — start, "Update amount", mark completed. Every
// write refreshes the list (and the Home numbers, which count published items).
import type { CampaignCreate, CampaignReceived } from '@mc/shared/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { masjidApi, masjidKeys } from '../../home/api/masjid-api.ts';

export function useCampaigns(masjidId: string | undefined) {
  const id = masjidId ?? '';
  return useQuery({
    queryKey: masjidKeys.campaigns(id),
    queryFn: ({ signal }) => masjidApi.campaigns(id, signal),
    enabled: masjidId !== undefined,
  });
}

export function useCampaignWrites(masjidId: string | undefined) {
  const queryClient = useQueryClient();
  const id = masjidId ?? '';
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: masjidKeys.campaigns(id) });
    await queryClient.invalidateQueries({ queryKey: masjidKeys.stats(id) });
    await queryClient.invalidateQueries({ queryKey: masjidKeys.quota(id) });
  };
  const create = useMutation({
    mutationFn: (body: CampaignCreate) => masjidApi.createCampaign(id, body),
    onSuccess: refresh,
  });
  const received = useMutation({
    mutationFn: ({ campaignId, body }: { readonly campaignId: string; readonly body: CampaignReceived }) =>
      masjidApi.campaignReceived(id, campaignId, body),
    onSuccess: refresh,
  });
  const complete = useMutation({
    mutationFn: (campaignId: string) => masjidApi.completeCampaign(id, campaignId),
    onSuccess: refresh,
  });
  return { create, received, complete };
}
