// Updates timeline (07 A13): followed masjids' feeds merged newest first. Each masjid's feed is paged separately; an
// item can only be shown once no masjid that still has older pages could have something newer that is not loaded yet.
// Also: date sections ("Today", "Yesterday", "26 Sep") and the filter chips present so far.
import { calendarDateInZone } from '@mc/domain/time';
import type { FeedItem, ItemType } from '@mc/shared/contracts/public';

export interface FeedStream {
  /** Loaded items of one masjid (pages concatenated, newest first). */
  readonly items: readonly FeedItem[];
  /** More (older) pages exist. */
  readonly hasMore: boolean;
}

export interface MergedTimeline {
  /** Safe to show, newest first. */
  readonly items: readonly FeedItem[];
  /** Streams to load a next page from when the list end is reached (those holding the merge back, or empty). */
  readonly next: readonly number[];
}

/** Sorts after every ISO timestamp: a stream with nothing loaded yet holds the whole merge back. */
const NOTHING_LOADED = String.fromCharCode(0xffff);

const newestFirst = (a: FeedItem, b: FeedItem) =>
  b.publishedAt.localeCompare(a.publishedAt) || a.publicId.localeCompare(b.publicId);

/**
 * Merges per-masjid streams.
 *
 * @returns the items newer than or equal to every unfinished stream's oldest loaded item, and which streams to page next.
 */
export function mergeTimeline(streams: readonly FeedStream[]): MergedTimeline {
  // The horizon: the newest of the unfinished streams' oldest loaded items; anything older may still be preceded by
  // unloaded items of that stream.
  const horizon = streams.reduce<string | null>((current, stream) => {
    if (!stream.hasMore) return current;
    const oldest = stream.items.at(-1)?.publishedAt ?? NOTHING_LOADED;
    return current === null || oldest > current ? oldest : current;
  }, null);
  const all = streams.flatMap((stream) => stream.items).sort(newestFirst);
  const items = horizon === null ? all : all.filter((item) => item.publishedAt >= horizon);
  const next = streams.flatMap((stream, index) => {
    if (!stream.hasMore) return [];
    const oldest = stream.items.at(-1)?.publishedAt ?? NOTHING_LOADED;
    return horizon !== null && oldest >= horizon ? [index] : [];
  });
  return { items, next };
}

export type TimelineFilter =
  'all' | 'announcements' | 'duas' | 'donations' | 'hadith' | 'bayans' | 'timings' | 'chanda';

/** Chips in order (07 A13) and the feed type each shows. */
export const FILTERS: readonly { readonly id: TimelineFilter; readonly type: ItemType | null }[] = [
  { id: 'all', type: null },
  { id: 'announcements', type: 'announcement' },
  { id: 'duas', type: 'dua_request' },
  { id: 'donations', type: 'campaign' },
  { id: 'hadith', type: 'daily_content' },
  { id: 'bayans', type: 'video' },
  { id: 'timings', type: 'timing_update' },
  { id: 'chanda', type: 'chanda_update' },
];

/** The chips to show: All, plus each type that appears in what is loaded so far (new types appear by themselves). */
export function availableFilters(items: readonly FeedItem[]): TimelineFilter[] {
  const present = new Set(items.map((item) => item.type));
  return FILTERS.flatMap((filter) => (filter.type === null || present.has(filter.type) ? [filter.id] : []));
}

export interface TimelineSection {
  /** IST calendar date "YYYY-MM-DD". */
  readonly date: string;
  readonly items: readonly FeedItem[];
}

/** Groups (already sorted) items by their IST calendar date. */
export function sectionsByDay(items: readonly FeedItem[]): TimelineSection[] {
  const sections: { date: string; items: FeedItem[] }[] = [];
  for (const item of items) {
    const date = calendarDateInZone(new Date(item.publishedAt));
    const last = sections.at(-1);
    if (last?.date === date) last.items.push(item);
    else sections.push({ date, items: [item] });
  }
  return sections;
}
