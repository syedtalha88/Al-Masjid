// The versions poller (01 §5.2) — its own module so TanStack's query observer is not part of the app entry (PROGRESS F43):
// screens that show masjid content load it with their chunk.
import type { MasjidVersions } from '@mc/shared/contracts/public';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { pruneStaleVersions, versionsQuery } from './api/queries.ts';
import { useAppData, useFollowedIds } from './data.tsx';

/**
 * The content versions of the followed masjids — polled on focus and every 60 s while visible; prunes cached queries
 * of older versions whenever new versions arrive.
 */
export function useMasjidVersions(): {
  readonly versions: MasjidVersions | undefined;
  /** `error` only when no versions are known at all (first open offline); cached versions keep working. */
  readonly failed: boolean;
  /** Checks the versions now (pull-to-refresh); resolves when the answer is in. */
  readonly refresh: () => Promise<void>;
} {
  const { api, queryClient } = useAppData();
  const ids = useFollowedIds();
  const query = useQuery({ ...versionsQuery(api, ids), placeholderData: (previous) => previous });
  useEffect(() => {
    if (query.data) pruneStaleVersions(queryClient, query.data);
  }, [query.data, queryClient]);
  return {
    versions: query.data,
    failed: query.isError && query.data === undefined,
    refresh: async () => {
      await query.refetch();
    },
  };
}
