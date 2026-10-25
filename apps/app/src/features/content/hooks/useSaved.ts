// Save / Saved (07 A8 bookmark, A15 Settings → Saved): kept on this phone only (device store), newest first, at most
// 500. Saving also keeps the item in the persisted item cache, so Saved opens offline.
import type { FeedItem, MasjidSummary } from '@mc/shared/contracts/public';
import { useToast } from '@mc/ui/components';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { now } from '../../../lib/clock.ts';
import { useAppData, useDeviceSelector } from '../../../lib/data.tsx';
import { primeItem } from './useItem.ts';

const MAX_SAVED = 500;

export function useSaved(labels: { readonly saved: string; readonly removed: string }) {
  const { store } = useAppData();
  const queryClient = useQueryClient();
  const toast = useToast();
  const saved = useDeviceSelector((state) => state.saved);
  const audience = useDeviceSelector((state) => state.audiencePref) ?? 'brothers';
  const ids = useMemo(() => new Set(saved.map((entry) => entry.publicId)), [saved]);

  const toggle = useCallback(
    (item: FeedItem, masjid: MasjidSummary | null) => {
      const wasSaved = store.current().saved.some((entry) => entry.publicId === item.publicId);
      void store
        .update((current) => ({
          ...current,
          saved: wasSaved
            ? current.saved.filter((entry) => entry.publicId !== item.publicId)
            : [{ publicId: item.publicId, savedAt: now().toISOString() }, ...current.saved].slice(0, MAX_SAVED),
        }))
        .then(() => {
          if (!wasSaved && masjid) primeItem(queryClient, audience, { item, masjid });
          toast.show({ message: wasSaved ? labels.removed : labels.saved, tone: 'success' });
        });
    },
    [store, queryClient, audience, toast, labels.saved, labels.removed],
  );

  const isSaved = useCallback((publicId: string) => ids.has(publicId), [ids]);
  return useMemo(() => ({ isSaved, toggle }), [isSaved, toggle]);
}
