// B9 chanda logic (07 B9, 00 §4.3, PHASE_05 T5.5): which weeks the stepper offers (this week back to half a year), the
// draft of the selected week (its saved amount and note), and what Save sends. Pure.
import { chandaWeekEnd, chandaWeekOf } from '@mc/domain/chanda';
import { addDays } from '@mc/domain/time';
import { type AdminChanda, CHANDA_NOTE_MAX, type ChandaWeekSave } from '@mc/shared/contracts';

/** The stepper goes back this many weeks (the B9 history is half a year). */
export const CHANDA_WEEKS_BACK = 26;

/** The week starts B9 offers (00 §4.3: Friday by default, Monday instead). */
export const CHANDA_WEEK_STARTS = [5, 1] as const;

/** The weeks the stepper can show, newest (this week) first. */
export function chandaWeekChoices(today: string, weekStart: number): string[] {
  const current = chandaWeekOf(today, weekStart);
  return Array.from({ length: CHANDA_WEEKS_BACK + 1 }, (_, index) => addDays(current, -7 * index));
}

export interface ChandaDraft {
  readonly amountPaise: number;
  readonly note: string;
}

/** The selected week's saved figures, or an empty draft for a week not entered yet. */
export function draftFor(chanda: AdminChanda | undefined, week: string): ChandaDraft {
  const saved = chanda?.weeks.find((entry) => entry.weekStart === week);
  return { amountPaise: saved?.amountPaise ?? 0, note: saved?.note ?? '' };
}

/** Whether the week was entered before (Save then corrects it). */
export const isSaved = (chanda: AdminChanda | undefined, week: string): boolean =>
  chanda?.weeks.some((entry) => entry.weekStart === week) ?? false;

/** The body of `PUT /chanda/:weekStart`: an empty note removes it; notify only while shown. */
export function chandaBody(draft: ChandaDraft, notify: boolean, shown: boolean): ChandaWeekSave {
  const note = draft.note.trim().slice(0, CHANDA_NOTE_MAX);
  return { amountPaise: draft.amountPaise, notify: notify && shown, ...(note === '' ? {} : { note }) };
}

/** First and last day of the week starting on `week`. */
export const weekRange = (week: string): { start: string; end: string } => ({ start: week, end: chandaWeekEnd(week) });
