// B8 data (PHASE_05 T5.2): the masjid's live UPI details with the request in progress, and "Send for approval". A sent
// request refreshes the status.
import type { PaymentRequest } from '@mc/shared/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { masjidApi, masjidKeys } from '../../home/api/masjid-api.ts';

export function usePayment(masjidId: string | undefined) {
  const id = masjidId ?? '';
  return useQuery({
    queryKey: masjidKeys.payment(id),
    queryFn: ({ signal }) => masjidApi.payment(id, signal),
    enabled: masjidId !== undefined,
  });
}

export function usePaymentRequest(masjidId: string | undefined) {
  const queryClient = useQueryClient();
  const id = masjidId ?? '';
  return useMutation({
    mutationFn: (body: PaymentRequest) => masjidApi.requestPayment(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: masjidKeys.payment(id) }),
  });
}
