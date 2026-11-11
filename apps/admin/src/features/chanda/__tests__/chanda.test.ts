// B9 logic (PHASE_05 T5.5): the stepper's weeks, the draft of a saved / new week, the Save body. Fake amounts only.
import type { AdminChanda } from '@mc/shared/contracts';
import { describe, expect, it } from 'vitest';

import { CHANDA_WEEKS_BACK, chandaBody, chandaWeekChoices, draftFor, isSaved, weekRange } from '../lib/chanda.ts';

const CHANDA: AdminChanda = {
  show: false,
  weekStart: 5,
  weeks: [
    { weekStart: '2026-11-06', amountPaise: 1_850_000, note: 'Test note', updatedAt: '2026-11-10T06:30:00.000Z' },
  ],
};

describe('B9 chanda', () => {
  it('offers this week first, then half a year back, on the masjid’s week-start day', () => {
    const fridays = chandaWeekChoices('2026-11-10', 5);
    expect(fridays[0]).toBe('2026-11-06');
    expect(fridays[1]).toBe('2026-10-30');
    expect(fridays).toHaveLength(CHANDA_WEEKS_BACK + 1);
    expect(chandaWeekChoices('2026-11-10', 1)[0]).toBe('2026-11-09');
  });

  it('a saved week opens with its figures; a new one empty', () => {
    expect(draftFor(CHANDA, '2026-11-06')).toEqual({ amountPaise: 1_850_000, note: 'Test note' });
    expect(isSaved(CHANDA, '2026-11-06')).toBe(true);
    expect(draftFor(CHANDA, '2026-10-30')).toEqual({ amountPaise: 0, note: '' });
    expect(isSaved(undefined, '2026-10-30')).toBe(false);
  });

  it('Save: the trimmed note or none; notify only while chanda is shown', () => {
    expect(chandaBody({ amountPaise: 100, note: '  Test  ' }, true, true)).toEqual({
      amountPaise: 100,
      note: 'Test',
      notify: true,
    });
    expect(chandaBody({ amountPaise: 100, note: '  ' }, true, false)).toEqual({ amountPaise: 100, notify: false });
  });

  it('a week runs 7 days', () => {
    expect(weekRange('2026-11-06')).toEqual({ start: '2026-11-06', end: '2026-11-12' });
  });
});
