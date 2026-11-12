// A11 Weekly Chanda view (07 A11, PHASE_05 T5.5): the headline week (this week when entered, else the latest) and the
// chart's 8 slots ending with this week — weeks not entered are empty slots. Pure.
import { CHANDA_CHART_WEEKS, chandaWeekOf, recentChandaWeeks } from '@mc/domain/chanda';
import type { ActiveMasjidBundle } from '@mc/shared/contracts/public';

export type ChandaWeek = NonNullable<ActiveMasjidBundle['chanda']>['weeks'][number];

export interface ChandaView {
  /** The big card: this week's total when entered, else the most recent week's (`null`: nothing entered). */
  readonly headline: (ChandaWeek & { readonly isThisWeek: boolean }) | null;
  /** The chart, oldest first: each of the last 8 weeks with its total or `null`. */
  readonly slots: readonly {
    readonly weekStart: string;
    readonly amountPaise: number | null;
    readonly current: boolean;
  }[];
}

/**
 * @param weeks - the bundle's weeks (oldest first).
 * @param weekStart - the masjid's week-start day (1 = Monday … 7 = Sunday).
 * @param today - "YYYY-MM-DD" (IST).
 */
export function chandaView(weeks: readonly ChandaWeek[], weekStart: number, today: string): ChandaView {
  const current = chandaWeekOf(today, weekStart);
  const latest = weeks.at(-1);
  const byWeek = new Map(weeks.map((week) => [week.weekStart, week]));
  return {
    headline: latest ? { ...latest, isThisWeek: latest.weekStart === current } : null,
    slots: recentChandaWeeks(today, weekStart, CHANDA_CHART_WEEKS).map((week) => ({
      weekStart: week,
      amountPaise: byWeek.get(week)?.amountPaise ?? null,
      current: week === current,
    })),
  };
}
