// TanStack Query key factory (03 §7). Versioned resources carry their content version `v` in the key: a new version
// is a new query, so a version change re-targets every screen at once (01 §5.2) and old versions are pruned.
import type { ItemType } from '@mc/shared/contracts/public';

const sortedIds = (ids: readonly string[]) => [...ids].sort().join(',');

export const queryKeys = {
  config: () => ['config'] as const,
  templates: () => ['templates'] as const,
  versions: (masjidIds: readonly string[]) => ['versions', sortedIds(masjidIds)] as const,
  bundle: (masjidId: string, v: number) => ['bundle', masjidId, v] as const,
  /** All bundle queries of a masjid (any version). */
  bundles: (masjidId: string) => ['bundle', masjidId] as const,
  feed: (masjidId: string, v: number, aud: 'brothers' | 'sisters', type?: ItemType) =>
    ['feed', masjidId, v, aud, type ?? 'all'] as const,
  feeds: (masjidId: string) => ['feed', masjidId] as const,
  item: (publicId: string, aud: 'brothers' | 'sisters') => ['item', publicId, aud] as const,
  ameenCounts: (publicIds: readonly string[]) => ['ameens', sortedIds(publicIds)] as const,
  library: (id: string) => ['library', id] as const,
  resolve: (code: string) => ['resolve', code] as const,
  serverFollows: () => ['serverFollows'] as const,
  device: () => ['device'] as const,
} as const;

/** Query roots that are persisted for offline use (01 §5.6); everything else lives in memory only. */
export const PERSISTED_ROOTS: ReadonlySet<string> = new Set([
  'config',
  'templates',
  'versions',
  'bundle',
  'feed',
  'item',
  'library',
]);
