// Updates data (07 A13): per followed masjid, its feed pages (first page shared with Home's cache; later pages by
// cursor), merged newest first by `mergeTimeline`. `loadMore` pages the masjids holding the merge back.
import type { FeedItem, FeedPage, ItemType } from '@mc/shared/contracts/public';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { feedPageQuery, feedQuery } from '../../../lib/api/queries.ts';
import { useAppData, useDeviceSelector, useFollowedIds } from '../../../lib/data.tsx';
import { useMasjidVersions } from '../../../lib/versions.ts';
import { type FeedStream, mergeTimeline } from '../lib/timeline.ts';

export interface Timeline {
  readonly items: readonly FeedItem[];
  /** Nothing loaded yet. */
  readonly loading: boolean;
  /** Older items exist (the list end shows a loader and asks for more). */
  readonly hasMore: boolean;
  /** A page is loading. */
  readonly fetching: boolean;
  readonly loadMore: () => void;
  /** No masjid followed. */
  readonly empty: boolean;
  readonly failed: boolean;
  readonly refresh: () => Promise<void>;
}

export function useTimeline(type: ItemType | undefined): Timeline {
  const { api } = useAppData();
  const queryClient = useQueryClient();
  const ids = useFollowedIds();
  const audiencePref = useDeviceSelector((state) => state.audiencePref);
  const audience = audiencePref ?? 'brothers';
  const { versions, failed, refresh } = useMasjidVersions();
  // Extra pages per masjid beyond the first, for this filter.
  const [extra, setExtra] = useState<Readonly<Record<string, number>>>({});
  const [forType, setForType] = useState(type);
  if (forType !== type) {
    setForType(type);
    setExtra({});
  }

  const active = useMemo(
    () =>
      ids.flatMap((id) => {
        const entry = versions?.[id];
        return entry?.status === 'active' ? [{ id, v: entry.v }] : [];
      }),
    [ids, versions],
  );

  // Page 0 of every masjid, then page k once page k−1 told its cursor.
  const firstPages = useQueries({
    queries: active.map(({ id, v }) => feedQuery(api, id, v, audience, type)),
  });
  const laterSpecs = active.flatMap(({ id, v }, index) => {
    const specs: { id: string; page: number; cursor: string }[] = [];
    let cursor = firstPages[index]?.data?.next ?? null;
    for (let page = 1; page <= (extra[id] ?? 0) && cursor !== null; page += 1) {
      specs.push({ id, page, cursor });
      // The next cursor comes from this page once it has loaded (observed below, so this render sees it).
      cursor =
        queryClient.getQueryData<FeedPage>(feedPageQuery(api, id, v, audience, type, cursor).queryKey)?.next ?? null;
    }
    return specs;
  });
  const laterPages = useQueries({
    queries: laterSpecs.map((spec) => {
      const v = active.find((entry) => entry.id === spec.id)?.v ?? 0;
      return feedPageQuery(api, spec.id, v, audience, type, spec.cursor);
    }),
  });

  const streams = useMemo((): FeedStream[] => {
    return active.map(({ id }, index) => {
      const pages: (FeedPage | undefined)[] = [firstPages[index]?.data];
      laterSpecs.forEach((spec, specIndex) => {
        if (spec.id === id) pages.push(laterPages[specIndex]?.data);
      });
      const items: FeedItem[] = [];
      let hasMore = false;
      for (const page of pages) {
        if (!page) {
          hasMore = true;
          break;
        }
        items.push(...page.items);
        hasMore = page.next !== null;
      }
      return { items, hasMore };
    });
  }, [active, firstPages, laterSpecs, laterPages]);

  const merged = useMemo(() => mergeTimeline(streams), [streams]);

  const loadMore = useCallback(() => {
    if (merged.next.length === 0) return;
    setExtra((current) => {
      const next = { ...current };
      for (const index of merged.next) {
        const entry = active[index];
        // Only when its latest page has arrived (its cursor is known).
        if (entry && streams[index]?.hasMore) next[entry.id] = (current[entry.id] ?? 0) + 1;
      }
      return next;
    });
  }, [merged.next, active, streams]);

  const fetching = [...firstPages, ...laterPages].some((query) => query.isFetching);
  return {
    items: merged.items,
    loading: merged.items.length === 0 && (versions === undefined || firstPages.some((query) => query.isPending)),
    hasMore: streams.some((stream) => stream.hasMore),
    fetching,
    loadMore,
    empty: ids.length === 0,
    failed: failed && ids.length > 0,
    refresh,
  };
}
