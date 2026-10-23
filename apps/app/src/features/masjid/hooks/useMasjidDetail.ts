// Masjid Detail data (07 A5): the masjid's bundle (from the followed masjids' data, or its own lookup when it is not
// followed), its follow entry (mute state, follow date) and the first feed page of each section type.
import type { ActiveMasjidBundle, FeedItem, ItemType } from '@mc/shared/contracts/public';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { bundleQuery, feedQuery, versionsQuery } from '../../../lib/api/queries.ts';
import { useAppData, useDeviceState } from '../../../lib/data.tsx';
import type { LocalFollow } from '../../../lib/device/store.ts';
import { useHomeData } from '../../home/hooks/useHomeData.ts';
import { SECTION_TYPES } from '../lib/detail-view.ts';

export type DetailState =
  | { readonly state: 'loading' | 'failed' | 'gone' }
  | { readonly state: 'suspended' }
  | { readonly state: 'active'; readonly bundle: ActiveMasjidBundle };

export interface MasjidDetailData {
  readonly masjid: DetailState;
  /** This device's follow (pending unfollows excluded), or `null`. */
  readonly follow: LocalFollow | null;
  readonly pages: ReadonlyMap<ItemType, readonly FeedItem[]>;
  readonly retry: () => void;
}

export function useMasjidDetail(masjidId: string): MasjidDetailData {
  const { api } = useAppData();
  const device = useDeviceState();
  const home = useHomeData();
  const followed = home.masjids.find((entry) => entry.id === masjidId);
  const follow = device.follows.find((entry) => entry.masjidId === masjidId && entry.sync !== 'unfollow') ?? null;

  // Not followed (opened from a link): its own version + bundle.
  const versions = useQuery({ ...versionsQuery(api, [masjidId]), enabled: followed === undefined });
  const ownVersion = versions.data?.[masjidId];
  const own = useQuery({
    ...bundleQuery(api, masjidId, ownVersion?.v ?? 0),
    enabled: followed === undefined && ownVersion !== undefined,
  });

  const masjid: DetailState = (() => {
    if (followed) {
      if (followed.state === 'active') return { state: 'active', bundle: followed.bundle };
      return { state: followed.state };
    }
    if (versions.data && !ownVersion) return { state: 'gone' };
    if (own.data?.status === 'active') return { state: 'active', bundle: own.data };
    if (own.data?.status === 'suspended') return { state: 'suspended' };
    return { state: versions.isError || own.isError ? 'failed' : 'loading' };
  })();

  const active = masjid.state === 'active' ? masjid.bundle : null;
  const audience = device.audiencePref ?? 'brothers';
  const feeds = useQueries({
    queries: SECTION_TYPES.map((type) => ({
      ...feedQuery(api, masjidId, active?.v ?? 0, audience, type),
      enabled: active !== null,
    })),
  });
  const pages = useMemo(
    () =>
      new Map(
        SECTION_TYPES.flatMap((type, index) => {
          const items = feeds[index]?.data?.items;
          return items ? [[type, items] as const] : [];
        }),
      ),
    [feeds],
  );

  return {
    masjid,
    follow,
    pages,
    retry: () => {
      void home.refresh();
      void versions.refetch();
    },
  };
}
