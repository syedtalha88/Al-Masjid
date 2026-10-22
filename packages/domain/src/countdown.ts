// Countdown buckets for the next jamaat (07 A2, 08 §5.5). Returns numbers only; `@mc/i18n` turns them into
// "2h 18m left" / "48m left" / "Starts in 8 min" / "Jamaat now" per locale.

import { JAMAAT_NOW_MS } from './prayer.ts';

/** Under this many minutes the label becomes "Starts in N min" (and turns primary — 07 A2). */
export const COUNTDOWN_SOON_MINUTES = 10;

export type Countdown =
  | { readonly kind: 'left'; readonly hours: number; readonly minutes: number }
  | { readonly kind: 'soon'; readonly minutes: number }
  | { readonly kind: 'now' }
  | { readonly kind: 'past' };

/**
 * The countdown state for a target instant.
 *
 * @param target - the jamaat (or Sehri/Iftar) instant.
 * @param now - the (drift-corrected) current instant.
 * @returns `left` (hours + minutes, rounded up) ≥ 10 min ahead, `soon` (1–9 min) under that, `now` for 10 minutes
 *   from the start, then `past`.
 */
export function countdown(target: Date, now: Date): Countdown {
  const remaining = target.getTime() - now.getTime();
  if (remaining <= 0) return remaining > -JAMAAT_NOW_MS ? { kind: 'now' } : { kind: 'past' };
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < COUNTDOWN_SOON_MINUTES) return { kind: 'soon', minutes };
  return { kind: 'left', hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
