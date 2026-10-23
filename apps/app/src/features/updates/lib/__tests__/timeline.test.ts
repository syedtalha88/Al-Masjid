import type { FeedItem, ItemType } from '@mc/shared/contracts/public';
import { describe, expect, it } from 'vitest';

import { availableFilters, mergeTimeline, sectionsByDay } from '../timeline.ts';

const item = (id: string, publishedAt: string, type: ItemType = 'announcement'): FeedItem => ({
  publicId: id,
  masjidId: '00000000-0000-4000-8000-000000000001',
  type,
  audience: 'everyone',
  isImportant: false,
  publishedAt,
});
const at = (day: number, hour = 10) => new Date(Date.UTC(2026, 9, day, hour)).toISOString();

describe('mergeTimeline', () => {
  it('finished streams merge completely, newest first', () => {
    const merged = mergeTimeline([
      { items: [item('a1', at(22)), item('a2', at(18))], hasMore: false },
      { items: [item('b1', at(21)), item('b2', at(20))], hasMore: false },
    ]);
    expect(merged.items.map((entry) => entry.publicId)).toEqual(['a1', 'b1', 'b2', 'a2']);
    expect(merged.next).toEqual([]);
  });

  it('holds back items older than an unfinished stream’s oldest loaded item, and asks for that stream', () => {
    const merged = mergeTimeline([
      { items: [item('a1', at(22)), item('a2', at(10))], hasMore: false },
      { items: [item('b1', at(21)), item('b2', at(20))], hasMore: true },
    ]);
    // a2 (day 10) could be preceded by unloaded B items (older than day 20 but newer than day 10).
    expect(merged.items.map((entry) => entry.publicId)).toEqual(['a1', 'b1', 'b2']);
    expect(merged.next).toEqual([1]);
  });

  it('a stream not loaded yet holds everything back', () => {
    const merged = mergeTimeline([
      { items: [item('a1', at(22))], hasMore: false },
      { items: [], hasMore: true },
    ]);
    expect(merged.items).toEqual([]);
    expect(merged.next).toEqual([1]);
  });

  it('several unfinished streams: the newest horizon wins; every stream at it is paged', () => {
    const merged = mergeTimeline([
      { items: [item('a1', at(22)), item('a2', at(15))], hasMore: true },
      { items: [item('b1', at(21)), item('b2', at(15))], hasMore: true },
      { items: [item('c1', at(23)), item('c2', at(5))], hasMore: true },
    ]);
    expect(merged.items.map((entry) => entry.publicId)).toEqual(['c1', 'a1', 'b1', 'a2', 'b2']);
    expect(merged.next).toEqual([0, 1]);
  });
});

describe('availableFilters', () => {
  it('All plus the types present, in chip order', () => {
    expect(
      availableFilters([
        item('1', at(1), 'video'),
        item('2', at(1), 'announcement'),
        item('3', at(1), 'chanda_update'),
      ]),
    ).toEqual(['all', 'announcements', 'bayans', 'chanda']);
    expect(availableFilters([])).toEqual(['all']);
  });
});

describe('sectionsByDay', () => {
  it('groups by the IST calendar date', () => {
    const sections = sectionsByDay([
      item('1', '2026-10-22T20:00:00.000Z'), // 23 Oct 01:30 IST
      item('2', '2026-10-22T10:00:00.000Z'), // 22 Oct
      item('3', '2026-10-22T05:00:00.000Z'), // 22 Oct
    ]);
    expect(sections.map((section) => [section.date, section.items.length])).toEqual([
      ['2026-10-23', 1],
      ['2026-10-22', 2],
    ]);
  });
});
