// A11 view (PHASE_05 T5.5): the headline week and the chart's 8 slots for 0, some and all weeks. Fake amounts only.
import { describe, expect, it } from 'vitest';

import { chandaView } from '../chanda-view.ts';

const TODAY = '2026-11-10'; // Tuesday: the Friday week started 2026-11-06

describe('chandaView', () => {
  it('no weeks: no headline, 8 empty slots ending with this week', () => {
    const view = chandaView([], 5, TODAY);
    expect(view.headline).toBeNull();
    expect(view.slots).toHaveLength(8);
    expect(view.slots.every((slot) => slot.amountPaise === null)).toBe(true);
    expect(view.slots.at(-1)).toEqual({ weekStart: '2026-11-06', amountPaise: null, current: true });
  });

  it('this week entered: it is the headline; older weeks fill their slots, gaps stay empty', () => {
    const view = chandaView(
      [
        { weekStart: '2026-10-23', amountPaise: 900_000 },
        { weekStart: '2026-11-06', amountPaise: 1_850_000, note: 'Test note' },
      ],
      5,
      TODAY,
    );
    expect(view.headline).toEqual({
      weekStart: '2026-11-06',
      amountPaise: 1_850_000,
      note: 'Test note',
      isThisWeek: true,
    });
    expect(view.slots.map((slot) => slot.amountPaise)).toEqual([
      null,
      null,
      null,
      null,
      null,
      900_000,
      null,
      1_850_000,
    ]);
  });

  it('only older weeks: the latest is the headline, not "this week"; weeks older than 8 are off the chart', () => {
    const view = chandaView(
      [
        { weekStart: '2026-08-07', amountPaise: 100 },
        { weekStart: '2026-10-30', amountPaise: 1_200_000 },
      ],
      5,
      TODAY,
    );
    expect(view.headline).toMatchObject({ weekStart: '2026-10-30', isThisWeek: false });
    expect(view.slots.filter((slot) => slot.amountPaise !== null)).toHaveLength(1);
  });
});
