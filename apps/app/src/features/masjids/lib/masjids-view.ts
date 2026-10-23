// My Masjids view helpers (07 A3): per-masjid "N new updates", the row tinted mint (the soonest jamaat), list moves.
import type { FeedItem } from '@mc/shared/contracts/public';

/**
 * Items of one masjid the user has not seen: newer than the last Updates visit and than when they followed it (so a
 * freshly followed masjid does not show its whole history as new).
 */
export function unseenCount(items: readonly FeedItem[], seenAt: string | undefined, followedAt: string): number {
  const since = seenAt !== undefined && seenAt > followedAt ? seenAt : followedAt;
  return items.filter((item) => item.publishedAt > since).length;
}

/**
 * The row to tint (07 A3: "mint for the masjid with the soonest jamaat").
 *
 * @param nextAt - each row's next jamaat instant (ms), `null` when it has none.
 * @returns the index of the earliest, or `null` when no row has a next jamaat.
 */
export function soonestIndex(nextAt: readonly (number | null)[]): number | null {
  let best: number | null = null;
  nextAt.forEach((at, index) => {
    if (at === null) return;
    const current = best === null ? null : nextAt[best];
    if (current === null || current === undefined || at < current) best = index;
  });
  return best;
}

/** `list` with the entry at `from` moved to `to` (clamped); the same array when nothing moves. */
export function moveItem<T>(list: readonly T[], from: number, to: number): readonly T[] {
  const target = Math.min(Math.max(to, 0), list.length - 1);
  if (from === target || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return list;
  next.splice(target, 0, moved);
  return next;
}
