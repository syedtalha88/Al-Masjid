// Masjid Detail data (07 A5): the masjid's bundle (from the followed masjids' data, or its own lookup when it is not
// followed), its follow entry (mute state, follow date) and the first feed page of each section type.
import type { FeedItem, ItemType } from '@mc/shared/contracts/public';
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import { feedQuery } from '../../../lib/api/queries.ts';
import { useAppData, useDeviceSelector } from '../../../lib/data.tsx';
import type { LocalFollow } from '../../../lib/device/store.ts';
import { SECTION_TYPES } from '../lib/detail-view.ts';
import { type BundleState, useMasjidBundle } from './useMasjidBundle.ts';

export type DetailState = BundleState;

export interface MasjidDetailData {
  readonly masjid: DetailState;
  /** This device's follow (pending unfollows excluded), or `null`. */
  readonly follow: LocalFollow | null;
  readonly pages: ReadonlyMap<ItemType, readonly FeedItem[]>;
  /** The device's Brother/Sister choice (feeds and Ilm contacts). */
  readonly audience: 'brothers' | 'sisters';
  readonly retry: () => void;
}

export function useMasjidDetail(masjidId: string): MasjidDetailData {
  const { api } = useAppData();
  const follows = useDeviceSelector((state) => state.follows);
  const audiencePref = useDeviceSelector((state) => state.audiencePref);
  const follow = follows.find((entry) => entry.masjidId === masjidId && entry.sync !== 'unfollow') ?? null;
  const { masjid, retry } = useMasjidBundle(masjidId);

  const active = masjid.state === 'active' ? masjid.bundle : null;
  const audience = audiencePref ?? 'brothers';
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
    audience,
    retry,
  };
}
