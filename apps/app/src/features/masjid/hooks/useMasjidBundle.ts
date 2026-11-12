// One masjid's bundle (01 §5.2) from wherever it is: the followed masjids' data, or — not followed (opened from a link
// or the post landing) — its own version + bundle lookup. Masjid Detail and the campaign detail (live UPI details) use it.
import type { ActiveMasjidBundle } from '@mc/shared/contracts/public';
import { useQuery } from '@tanstack/react-query';

import { bundleQuery, previousBundle, versionsQuery } from '../../../lib/api/queries.ts';
import { useAppData } from '../../../lib/data.tsx';
import { useHomeData } from '../../home/hooks/useHomeData.ts';

export type BundleState =
  | { readonly state: 'loading' | 'failed' | 'gone' }
  | { readonly state: 'suspended' }
  | { readonly state: 'active'; readonly bundle: ActiveMasjidBundle };

export interface MasjidBundleData {
  readonly masjid: BundleState;
  /** Checks again (followed masjids: Home's refresh; others: their version). */
  readonly retry: () => void;
}

export function useMasjidBundle(masjidId: string): MasjidBundleData {
  const { api, queryClient } = useAppData();
  const home = useHomeData();
  const followed = home.masjids.find((entry) => entry.id === masjidId);

  // Not followed: its own version + bundle.
  const versions = useQuery({ ...versionsQuery(api, [masjidId]), enabled: followed === undefined && masjidId !== '' });
  const ownVersion = versions.data?.[masjidId];
  const own = useQuery({
    ...bundleQuery(api, masjidId, ownVersion?.v ?? 0),
    enabled: followed === undefined && ownVersion !== undefined,
    placeholderData: () => previousBundle(queryClient, masjidId, ownVersion?.v ?? 0),
  });

  const masjid: BundleState = (() => {
    if (followed) {
      if (followed.state === 'active') return { state: 'active', bundle: followed.bundle };
      return { state: followed.state };
    }
    if (versions.data && !ownVersion) return { state: 'gone' };
    if (own.data?.status === 'active') return { state: 'active', bundle: own.data };
    if (own.data?.status === 'suspended') return { state: 'suspended' };
    return { state: versions.isError || own.isError ? 'failed' : 'loading' };
  })();

  return {
    masjid,
    retry: () => {
      void home.refresh();
      void versions.refetch();
    },
  };
}
