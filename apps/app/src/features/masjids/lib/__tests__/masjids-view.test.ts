import type { FeedItem } from '@mc/shared/contracts/public';
import { describe, expect, it } from 'vitest';

import { moveItem, soonestIndex, unseenCount } from '../masjids-view.ts';

const item = (publishedAt: string): FeedItem => ({
  publicId: `p${publishedAt.replace(/\D/g, '').slice(0, 10)}`,
  masjidId: '00000000-0000-4000-8000-000000000001',
  type: 'announcement',
  audience: 'everyone',
  isImportant: false,
  publishedAt,
});

describe('unseenCount', () => {
  const items = ['2026-10-20T10:00:00.000Z', '2026-10-21T10:00:00.000Z', '2026-10-22T10:00:00.000Z'].map(item);

  it('counts items newer than both the last Updates visit and the follow', () => {
    expect(unseenCount(items, '2026-10-20T12:00:00.000Z', '2026-10-01T00:00:00.000Z')).toBe(2);
    // Followed after the last visit: only what came after the follow.
    expect(unseenCount(items, '2026-10-01T00:00:00.000Z', '2026-10-21T12:00:00.000Z')).toBe(1);
    // Never visited Updates: since the follow.
    expect(unseenCount(items, undefined, '2026-10-19T00:00:00.000Z')).toBe(3);
    expect(unseenCount([], undefined, '2026-10-19T00:00:00.000Z')).toBe(0);
  });
});

describe('soonestIndex', () => {
  it('the earliest next jamaat; null when none', () => {
    expect(soonestIndex([300, 100, null, 200])).toBe(1);
    expect(soonestIndex([null, 50])).toBe(1);
    expect(soonestIndex([null, null])).toBeNull();
    expect(soonestIndex([])).toBeNull();
  });
});

describe('moveItem', () => {
  it('moves and clamps; no-op returns the same array', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(list, 1, 9)).toEqual(['a', 'c', 'd', 'b']);
    expect(moveItem(list, 2, 2)).toBe(list);
    expect(moveItem(list, 7, 0)).toBe(list);
  });
});
