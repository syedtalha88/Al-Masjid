import { useCallback } from 'react';

import { useAppData } from '../../lib/data.tsx';

export type FollowResult = 'added' | 'already' | 'limit';

/**
 * Follows a masjid on this device at once (it appears in every list) and tells the server in the background; offline
 * or unregistered, the sync queue sends it later (T2.3). Refuses beyond 20 masjids (00 §4.1).
 */
export function useFollow(): (masjidId: string) => Promise<FollowResult> {
  const data = useAppData();
  return useCallback(
    async (masjidId: string) => {
      const sync = await import('../../lib/device/sync.ts');
      const result = await sync.followLocally(data.store, masjidId, new Date());
      if (result === 'added') {
        void sync.syncFollows(data.sync).catch(() => undefined); // retried by the queue
      }
      return result;
    },
    [data],
  );
}
